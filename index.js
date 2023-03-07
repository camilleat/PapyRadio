'use strict'; //Assure le strict mode du plugin pour éviter les erreurs de code

var libQ = require('kew');
var fs=require('fs-extra');
const path=require('path');
var exec = require('child_process').exec;
var spawn = require('child_process').spawn;

const Gpio = require('onoff').Gpio;
const io = require('socket.io-client');
const dtoverlayRegex = /^([0-9]+):\s+rotary-encoder\s+pin_a=([0-9]+) pin_b=([0-9]+).*$/gm
const fs = require('fs');

const maxRotaries = 2;
const rotaryTypes = new Array(
	"...",
	"1/1",
	"1/2",
	"...",
	"1/4"
);
const dialActions = new Array(
	"VOLUME",
	"SKIP"
);
const btnActions = new Array(
	"PLAYPAUSE",
	"STOP",
	"SHUTDOWN",
	"REBOOT"
);

var frequence_courante = "87.6 FM";

//Constructeur ----------------------------------------------------------------------------------------------------------------------------------------------------

module.exports = PapyRadio;
function PapyRadio(context) {
	var self = this;

	this.context = context;
	this.commandRouter = this.context.coreCommand;
	this.logger = this.context.logger;
	this.configManager = this.context.configManager;
}

//Configure les settings quand l'appli Volumio démarre ------------------------------------------------------------------------------------------------------------

PapyRadio.prototype.onVolumioStart = function()
{
	var self = this;
	var configFile=this.commandRouter.pluginManager.getConfigurationFile(this.context,'config.json');
	this.config = new (require('v-conf'))();
	this.config.loadFile(configFile);

    return libQ.resolve();
}


//Configure les settings quand le plugin PapyRadio démarre ------------------------------------------------------------------------------------------------------------
PapyRadio.prototype.onStart = async function() {
    var self = this;
	var defer=libQ.defer();
	
	self.debugLogging = (self.config.get('logging')==true);
	self.handles=[].fill(null,0,maxRotaries);
	self.buttons=[].fill(null,0,maxRotaries);
	self.pushDownTime=[].fill(0,0,maxRotaries);
	self.status=null;
	self.loadI18nStrings();

	if (self.debugLogging) self.logger.info('[PAPYRADIO] onStart: Config loaded: ' + JSON.stringify(self.config));

	self.socket = io.connect('http://localhost:3000');
	self.socket.emit('getState');
	self.socket.on('pushState',function(data){
		self.status = data;
		self.lastTime = data.seek - Date.now();
		// if (self.debugLogging) self.logger.info('[PAPYRADIO] received Websock Status: ' + JSON.stringify(self.status));
	})

	self.activateRotaries([...Array(maxRotaries).keys()])
	.then(_=>{
		return self.activateButtons([...Array(maxRotaries).keys()])
	})
	.then(_=> {
		self.commandRouter.pushToastMessage('success',"Rotary Encoder II - successfully loaded")
		if (self.debugLogging) self.logger.info('[PAPYRADIO] onStart: Plugin successfully started.');				
		defer.resolve();				
	})
	.fail(error => {
		self.commandRouter.pushToastMessage('error',"Rotary Encoder II", self.getI18nString('PAPYRADIO.TOAST_STOP_FAIL'))
		self.logger.error('[PAPYRADIO] onStart: Rotarys not initialized: '+error);
		defer.reject();
	});
	let station = await self.readURL(frequence_courante);
	self.playRadio(station);

    return defer.promise;
};



//Configure les settings quand le plugin PapyRadio s'arrête ------------------------------------------------------------------------------------------------------------
PapyRadio.prototype.onStop = function() {
    var self = this;
    var defer=libQ.defer();

	if (self.debugLogging) self.logger.info('[PAPYRADIO] onStop: Stopping Plugin.');

	self.deactivateRotaries([...Array(maxRotaries).keys()])
	.then(_=>{
		return self.deactivateButtons([...Array(maxRotaries).keys()])
	})
	.then(_=> {
		self.socket.off('pushState');
		self.socket.disconnect();
	})
	.then(_=>{
		self.commandRouter.pushToastMessage('success',"Papy Radio", self.getI18nString('PAPYRADIO.TOAST_STOP_SUCCESS'))
		if (self.debugLogging) self.logger.info('[PAPYRADIO] onStop: Plugin successfully stopped.');				
		defer.resolve();	
	})
	.fail(err=>{
		self.commandRouter.pushToastMessage('success',"Papy Radio", self.getI18nString('PAPYRADIO.TOAST_STOP_FAIL'))
		self.logger.error('[PAPYRADIO] onStop: Failed to cleanly stop plugin.'+err);				
		defer.reject();	
	})
    return defer.promise;
};


//Configure les settings quand le plugin PapyRadio redémarre ------------------------------------------------------------------------------------------------------------
PapyRadio.prototype.onRestart = function() {
    var self = this;
    var defer=libQ.defer();

	if (self.debugLogging) self.logger.info('[PAPYRADIO] onRestart: free resources');
};



//Configuration Methods ------------------------------------------------------------------------------------------------------------------------------------------

PapyRadio.prototype.getUIConfig = function() {
    var defer = libQ.defer();
    var self = this;

	if (self.debugLogging) self.logger.info('[PAPYRADIO] getUIConfig: starting: ');
	if (self.debugLogging) self.logger.info('[PAPYRADIO] getUIConfig: i18nStrings'+JSON.stringify(self.i18nStrings));
	if (self.debugLogging) self.logger.info('[PAPYRADIO] getUIConfig: i18nStringsDefaults'+JSON.stringify(self.i18nStringsDefaults));

    var lang_code = this.commandRouter.sharedVars.get('language_code');

	if (self.debugLogging) self.logger.info('[PAPYRADIO] getUIConfig: language code: ' + lang_code + ' dir: ' + __dirname);

    self.commandRouter.i18nJson(__dirname+'/i18n/strings_'+lang_code+'.json',
        __dirname+'/i18n/strings_en.json',
        __dirname + '/UIConfig.json')
        .then(function(uiconf)
        {
			//Settings for rotaries
			for (let i = 0; i < maxRotaries; i++) {
				uiconf.sections[i].content[0].value = (self.config.get('enabled' + i)==true)
				uiconf.sections[i].content[1].value.value = self.config.get('rotaryType' + i) | 0;
				uiconf.sections[i].content[1].value.label = rotaryTypes[parseInt(self.config.get('rotaryType' + i))|0];
				uiconf.sections[i].content[2].value = parseInt(self.config.get('pinA' + i)) | 0;
				uiconf.sections[i].content[3].value = parseInt(self.config.get('pinB' + i)) | 0;
				uiconf.sections[i].content[4].value.value = self.config.get('dialAction' + i) | 0;
				uiconf.sections[i].content[4].value.label = self.getI18nString('PAPYRADIO.'+dialActions[parseInt(self.config.get('dialAction' + i))|0]);
				uiconf.sections[i].content[5].value = self.config.get('socketCmdCCW' + i);
				uiconf.sections[i].content[6].value = self.config.get('socketDataCCW' + i);
				uiconf.sections[i].content[7].value = self.config.get('socketCmdCW' + i);
				uiconf.sections[i].content[8].value = self.config.get('socketDataCW' + i);
				uiconf.sections[i].content[9].value = parseInt(self.config.get('pinPush' + i)) | 0;
				uiconf.sections[i].content[10].value = parseInt(self.config.get('pinPushDebounce' + i)) | 0;
				uiconf.sections[i].content[11].value = (self.config.get('pushState' + i)==true)
				uiconf.sections[i].content[12].value.value = self.config.get('pushAction' + i) | 0;
				uiconf.sections[i].content[12].value.label = self.getI18nString('PAPYRADIO.'+btnActions[parseInt(self.config.get('pushAction' + i))|0]);
				uiconf.sections[i].content[13].value = self.config.get('socketCmdPush' + i);
				uiconf.sections[i].content[14].value = self.config.get('socketDataPush' + i);
				uiconf.sections[i].content[15].value.value = self.config.get('longPushAction' + i) | 0;
				uiconf.sections[i].content[15].value.label = self.getI18nString('PAPYRADIO.'+btnActions[parseInt(self.config.get('longPushAction' + i))|0]);
				uiconf.sections[i].content[16].value = self.config.get('socketCmdLongPush' + i);
				uiconf.sections[i].content[17].value = self.config.get('socketDataLongPush' + i);	
			}
			//logging section
			uiconf.sections[maxRotaries].content[0].value = (self.config.get('logging')==true)
            defer.resolve(uiconf);
        })
        .fail(function()
        {
            defer.reject(new Error());
        });

    return defer.promise;
};

PapyRadio.prototype.getConfigurationFiles = function() {
	return ['config.json'];
}



//Function to recursively activate all rotaries that are passed by Index in an Array -----------------------------------------------------------------------
PapyRadio.prototype.activateRotaries = function (rotaryIndexArray) {
	var self = this;
	var defer = libQ.defer();
	var rotaryIndex;

	if (self.debugLogging) self.logger.info('[PAPYRADIO] activateRotaries: ' + rotaryIndexArray.map(i =>  {return i + 1}));

	if (Array.isArray(rotaryIndexArray)){
		if (rotaryIndexArray.length > 0) {
			rotaryIndex = rotaryIndexArray[rotaryIndexArray.length - 1];
			return self.activateRotaries(rotaryIndexArray.slice(0,rotaryIndexArray.length - 1))
			.then(_=> {
				if (self.config.get('enabled'+rotaryIndex)) {
					return self.addOverlay(self.config.get('pinA'+rotaryIndex),self.config.get('pinB'+rotaryIndex),self.config.get('rotaryType'+rotaryIndex))
					.then(_=>{
						return self.attachListener(self.config.get('pinA'+rotaryIndex));
					})
					.then(handle => {
						return self.addEventHandle(handle, rotaryIndex)
					})								
				} else {
					return defer.resolve();
				}
			})
		} else {
			if (self.debugLogging) self.logger.info('[PAPYRADIO] activateRotaries: end of recursion.');
			defer.resolve();
		}
	} else {
		self.logger.error('[PAPYRADIO] activateRotaries: rotaryIndexArray must be an Array');
		defer.reject('rotaryIndexArray must be an Array of integers')
	} 
	return defer.promise;
}




//Function to recursively deactivate all rotaries that are passed by Index in an Array ------------------------------------------------------------ 
PapyRadio.prototype.deactivateRotaries = function (rotaryIndexArray) {
	var self = this;
	var defer = libQ.defer();
	var rotaryIndex;

	if (self.debugLogging) self.logger.info('[PAPYRADIO] deactivateRotaries: ' + rotaryIndexArray.map(i =>  {return i + 1}));

	if (Array.isArray(rotaryIndexArray)){
		if (rotaryIndexArray.length > 0) {
			rotaryIndex = rotaryIndexArray[0];
			self.deactivateRotaries(rotaryIndexArray.slice(1,rotaryIndexArray.length))
			.then(_=> {
				if (self.config.get('enabled'+rotaryIndex)) {
					return self.detachListener(self.handles[rotaryIndex])
					.then(_=>{ return self.checkOverlayExists(rotaryIndex)})
					.then(idx=>{if (idx > -1) return self.removeOverlay(idx)})
					.then(_=>{
						if (self.debugLogging) self.logger.info('[PAPYRADIO] deactivateRotaries: deactivated rotary' + (rotaryIndex + 1));
						return defer.resolve();
					})												
				} else {
					return defer.resolve()
				}
			})
		} else {
			if (self.debugLogging) self.logger.info('[PAPYRADIO] deactivateRotaries: end of recursion.');
			defer.resolve();
		}
	} else {
		self.logger.error('[PAPYRADIO] deactivateRotaries: rotaryIndexArray must be an Array: ' + rotaryIndexArray);
		defer.reject('rotaryIndexArray must be an Array of integers')
	} 
	return defer.promise;
}



//Function to recursively activate all buttons that are passed by Index in an Array -----------------------------------------------------------------------
PapyRadio.prototype.activateButtons = function (rotaryIndexArray) {
	var self = this;
	var defer = libQ.defer();
	var rotaryIndex;

	if (self.debugLogging) self.logger.info('[PAPYRADIO] activateButtons: ' + rotaryIndexArray.map(i =>  {return i + 1}));

	if (Array.isArray(rotaryIndexArray)){
		if (rotaryIndexArray.length > 0) {
			rotaryIndex = rotaryIndexArray[rotaryIndexArray.length - 1];
			self.activateButtons(rotaryIndexArray.slice(0,rotaryIndexArray.length - 1))
			.then(_=> {
				if (self.config.get('enabled'+rotaryIndex)) {
					var gpio = self.config.get('pinPush'+rotaryIndex);
					//configure pushButton if not disabled
					if (Number.isInteger(gpio) && (gpio > 0)) {
						gpio = parseInt(gpio);
						var debounce = self.config.get('pinPushDebounce'+rotaryIndex);
						if (!Number.isInteger(debounce)){
							debounce = 0
						} else {
							debounce = parseInt(debounce);
						};
						if (self.debugLogging) self.logger.info('[PAPYRADIO] activateButtons: Now assign push button: ' + (rotaryIndex + 1));
						self.buttons[rotaryIndex] = new Gpio(gpio, 'in', 'both', {debounceTimeout: debounce});
						self.buttons[rotaryIndex].watch((err,value) => {
							if (err) {
								return self.logger.error('[PAPYRADIO] Push Button '+(rotaryIndex+1)+' caused an error.')
							}
							switch (value==self.config.get('pushState'+rotaryIndex)) {
								case true: //(falling edge & active_high) or (rising edge and active low) = released
									var pushTime = Date.now() - self.pushDownTime[rotaryIndex]
									if (self.debugLogging) self.logger.info('[PAPYRADIO] Push Button '+(rotaryIndex+1)+' released after '+pushTime+'ms.');
									if (pushTime > 1500) {
										self.emitPushCommand(true, rotaryIndex)
									} else {
										self.emitPushCommand(false, rotaryIndex)
									}
									break;
							
								case false: //(falling edge & active low) or (rising edge and active high) = pressed
									if (self.debugLogging) self.logger.info('[PAPYRADIO] Push Button '+(rotaryIndex+1)+' pressed.');
									self.pushDownTime[rotaryIndex] = Date.now();						
									break;
							
								default:
									break;
							}
						})
						if (self.debugLogging) self.logger.info('[PAPYRADIO] Push Button '+(rotaryIndex+1)+' now resolving.');
						return defer.resolve();	
					} else {
						if (self.debugLogging) self.logger.info('[PAPYRADIO] Push Button '+(rotaryIndex+1)+' is disabled (no Gpio).');
						return defer.resolve();	
					}						
				} else {
					return defer.resolve();	
				}
			})
		} else {
			if (self.debugLogging) self.logger.info('[PAPYRADIO] activateButtons: end of recursion.');
			defer.resolve();
		}
	} else {
		self.logger.error('[PAPYRADIO] activateButtons: rotaryIndexArray must be an Array');
		defer.reject('rotaryIndexArray must be an Array of integers')
	} 

	return defer.promise;
}


//Function to recursively deactivate all buttons that are passed by Index in an Array -------------------------------------------------------------------------
PapyRadio.prototype.deactivateButtons = function (rotaryIndexArray) {
	var self = this;
	var defer = libQ.defer();
	var rotaryIndex;

	if (self.debugLogging) self.logger.info('[PAPYRADIO] deactivateButtons: ' + rotaryIndexArray.map(i =>  {return i + 1}));

	if (Array.isArray(rotaryIndexArray)){
		if (rotaryIndexArray.length > 0) {
			rotaryIndex = rotaryIndexArray[0];
			self.deactivateButtons(rotaryIndexArray.slice(1,rotaryIndexArray.length))
			.then(_=>{
				if (self.config.get('enabled'+rotaryIndex)) {
					if (self.config.get('pinPush1'+rotaryIndex)>0) {
						self.buttons[rotaryIndex].unwatchAll();
						self.buttons[rotaryIndex].unexport();
						if (self.debugLogging) self.logger.info('[PAPYRADIO] deactivateButtons: deactivated button ' + (rotaryIndex + 1));
						defer.resolve();	
					} else {
						if (self.debugLogging) self.logger.info('[PAPYRADIO] deactivateButtons: button ' + (rotaryIndex + 1) + ' is disabled.');
						defer.resolve();	
					}						
				} else {
					defer.resolve();
				}

			})
		} else {
			if (self.debugLogging) self.logger.info('[PAPYRADIO] deactivateButtons: end of recursion.');
			defer.resolve();
		}
	} else {
		self.logger.error('[PAPYRADIO] deactivateButtons: rotaryIndexArray must be an Array');
		defer.reject('rotaryIndexArray must be an Array of integers')
	} 
	return defer.promise;
}


//CODE DU PLUGIN --------------------------------------------------------------------------------------------------------------------------------------- 

PapyRadio.prototype.addEventHandle = function (handle, rotaryIndex) {
	var self = this; 

	if (self.debugLogging) self.logger.info('[PAPYRADIO] addEventHandle for rotary: ' + (rotaryIndex + 1));

	self.handles[rotaryIndex]=handle;
	self.handles[rotaryIndex].stdout.on("data", function (chunk) {
		var i=0;
		while (chunk.length - i >= 16) {
			var type = chunk.readUInt16LE(i+8)
			var value = chunk.readInt32LE(i+12)
			i += 16
			if (type == 2) {
				if (self.debugLogging) self.logger.info('[PAPYRADIO] addEventHandle received from rotary: '+(rotaryIndex +1) + ' -> Dir: '+value)
				self.emitDialCommand(value,rotaryIndex)
			} 
		}
	});

}

PapyRadio.prototype.readURL = function(frequence){
    return new Promise((resolve, reject) => {
        fs.readFile('./radios.json', 'utf-8', (err, data) => {
            if (err) reject(err);
            const radioData = JSON.parse(data);
            let radio = radioData.radios.find(radio => frequence === radio.frequency);
            let urlRadio = "";
            if(radio) {
                urlRadio = radio.url;
            }
            resolve(urlRadio);
        });
    });
};

PapyRadioPlugin.prototype.playRadio = function(station){
    socket.emit('replaceAndPlay', {
        service:'webradio',
        type:'webradio',
        title:station,
        uri: station
    });
}


//gère les rotary encoders
PapyRadio.prototype.emitDialCommand = async function(val,rotaryIndex){
	var self = this;
	var action = self.config.get('dialAction'+rotaryIndex)
	if (self.debugLogging) self.logger.info('[PAPYRADIO] emitDialCommand: '+action + ' with value ' + val + 'for Rotary: '+(rotaryIndex + 1))

	switch (val) {
		case 1: //CW
			switch (action) {
				case dialActions.indexOf("VOLUME"): //0
					self.socket.emit('volume','+');					
					if (self.debugLogging) self.logger.info('[PAPYRADIO] emitDialCommand: VOLUME UP')
					break;
			
				case dialActions.indexOf("SKIP"): //1
					self.socket.emit('next');
					
					// Read the JSON file
					break;			
				default:
					break;
			}
			break;
		case -1: //CCW
			switch (action) {
				case dialActions.indexOf("VOLUME"): //0
					self.socket.emit('volume','-');					
					if (self.debugLogging) self.logger.info('[ROTARYENCODER2] emitDialCommand: VOLUME DOWN')
					break;
			
				case dialActions.indexOf("SKIP"): //1
					self.socket.emit('prev');				
					break;
				default:
					break;
			}
			break;
		default:
			break;
	}
}

//gère les boutons
PapyRadio.prototype.emitPushCommand = function(longPress,rotaryIndex){
	var self = this;
	var cmd = '';
	var data = '';
	if (longPress) {
		var action = self.config.get('longPushAction'+rotaryIndex)
		if (action == btnActions.indexOf("EMIT")) {
			cmd = self.config.get('socketCmdLongPush' + rotaryIndex);
			data = self.config.get('socketDataLongPush' + rotaryIndex);
		} 
	} else {
		var action = self.config.get('pushAction'+rotaryIndex)
		if (action == btnActions.indexOf("EMIT")) {
			cmd = self.config.get('socketCmdPush' + rotaryIndex);
			data = self.config.get('socketDataPush' + rotaryIndex);
		} 
	}
	if (self.debugLogging) self.logger.info('[PAPYRADIO] emitPushCommand: '+action + 'for Rotary: '+(rotaryIndex + 1))

	switch (action) {
		case btnActions.indexOf("PLAY"): //1
			self.socket.emit('play')
			// Check if the radio was found
		
			break;
		case btnActions.indexOf("STOP"): //1
			self.socket.emit('stop')
			break;
		case btnActions.indexOf("SHUTDOWN"): //2
			self.socket.emit('shutdown')
			break;
		case btnActions.indexOf("REBOOT"): //
			self.socket.emit('reboot')
			break;
			
		default:
			break;
	}
}


