//FAUT DEPLACER CETTE PARTIE LA ---------------------------------------------------------------------------------------------

const fs = require('fs');
const re = require('socket.io-client');
var frequence = 103.1;

// Read the JSON file
fs.readFile('./radios.json', 'utf-8', (err, data) => {
    if (err) throw err;

    // Parse the JSON data
    const radioData = JSON.parse(data);

    // Get the radio frequency passed as parameter
    //const radioFrequency = process.argv[2];

    // Search for the radio with the given frequency
    let freqFM = frequence.toString() + " FM";
    const radio = radioData.radios.find(radio => radio.frequency === freqFM);
    console.log(radio);

    // Check if the radio was found
    if (radio) {
        // Get the URL of the radio
            const radioURL = radio.url;
            const radioURlString = radioURL.toString();
            console.log(radioURL);
            // Play the radio using Volumio
            const socket = re.io("http://volumio.local");
            socket.emit('play', {"value": radioURlString});
            console.log("Playing webRadio : " + radioURlString);
            //socket.close();
    } else {
        console.error(`Radio with frequency ${freqFM} not found`);
    }
});


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
	"SKIP",
);
const btnActions = new Array(
	"PLAYPAUSE",
	"STOP",
	"SHUTDOWN",
	"REBOOT",
);

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
PapyRadio.prototype.onStart = function() {
    var self = this;
	var defer=libQ.defer();
	
	self.debugLogging = (self.config.get('logging')==true);
	self.handles=[].fill(null,0,maxRotaries);
	self.buttons=[].fill(null,0,maxRotaries);
	self.pushDownTime=[].fill(0,0,maxRotaries);
	self.status=null;
	self.loadI18nStrings();

	if (self.debugLogging) self.logger.info('[PAPAYRADIO] onStart: Config loaded: ' + JSON.stringify(self.config));

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
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] onStart: Plugin successfully started.');				
		defer.resolve();				
	})
	.fail(error => {
		self.commandRouter.pushToastMessage('error',"Rotary Encoder II", self.getI18nString('ROTARYENCODER2.TOAST_STOP_FAIL'))
		self.logger.error('[ROTARYENCODER2] onStart: Rotarys not initialized: '+error);
		defer.reject();
	});

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



//Gets called when user saves settings from the GUI  -----------------------------------------------------------------------------------------------------------------------------------
rotaryencoder2.prototype.updateEncoder = function(data){
	var self = this;
	var defer = libQ.defer();
	var dataString = JSON.stringify(data);

	var rotaryIndex = parseInt(dataString.match(/rotaryType([0-9])/)[1]);
	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] updateEncoder: Rotary'+(rotaryIndex + 1)+' with:' + JSON.stringify(data));

	self.sanityCheckSettings(rotaryIndex, data)
	.then(_ => {
		//disable all rotaries before we make changes
		//this is necessary, since there seems to be an issue in the Kernel, that breaks the 
		//eventHandlers if a dtoverlay with low index is removed and others with higher index exist
		return self.deactivateRotaries([...Array(maxRotaries).keys()])
		.then(_=>{
			return self.deactivateButtons([...Array(maxRotaries).keys()])
		})
	})
	.then(_ => {
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] updateEncoder: Changing Encoder '+(rotaryIndex + 1)+' Settings to new values');
		if (data['enabled'+rotaryIndex]==true) {
			self.config.set('rotaryType'+rotaryIndex, (data['rotaryType'+rotaryIndex].value));
			self.config.set('pinA'+rotaryIndex, (data['pinA'+rotaryIndex]));
			self.config.set('pinB'+rotaryIndex, (data['pinB'+rotaryIndex]));
			self.config.set('dialAction'+rotaryIndex, (data['dialAction'+rotaryIndex].value));
			self.config.set('socketCmdCCW'+rotaryIndex, (data['socketCmdCCW'+rotaryIndex]));
			self.config.set('socketDataCCW'+rotaryIndex, (data['socketDataCCW'+rotaryIndex]));
			self.config.set('socketCmdCW'+rotaryIndex, (data['socketCmdCW'+rotaryIndex]));
			self.config.set('socketDataCW'+rotaryIndex, (data['socketDataCW'+rotaryIndex]));
			self.config.set('pinPush'+rotaryIndex, (data['pinPush'+rotaryIndex]));
			self.config.set('pinPushDebounce'+rotaryIndex, (data['pinPushDebounce'+rotaryIndex]));
			self.config.set('pushState'+rotaryIndex,(data['pushState'+rotaryIndex]))
			self.config.set('pushAction'+rotaryIndex, (data['pushAction'+rotaryIndex].value));
			self.config.set('socketCmdPush'+rotaryIndex, (data['socketCmdPush'+rotaryIndex]));
			self.config.set('socketDataPush'+rotaryIndex, (data['socketDataPush'+rotaryIndex]));
			self.config.set('longPushAction'+rotaryIndex, (data['longPushAction'+rotaryIndex].value));
			self.config.set('socketCmdLongPush'+rotaryIndex, (data['socketCmdLongPush'+rotaryIndex]));
			self.config.set('socketDataLongPush'+rotaryIndex, (data['socketDataLongPush'+rotaryIndex]));
			self.config.set('enabled'+rotaryIndex, true);	
		} else {
			self.config.set('enabled'+rotaryIndex, false);
		}
		return self.activateRotaries([...Array(maxRotaries).keys()])
		.then(_=>{
			return self.activateButtons([...Array(maxRotaries).keys()])
		})
	})
	.then(_ => {
		if (self.debugLogging) self.logger.info('[ROTARYENCODER2] updateEncoder: SUCCESS with Toast: '+self.getI18nString('ROTARYENCODER2.TOAST_SAVE_SUCCESS')+' ' +self.getI18nString('ROTARYENCODER2.TOAST_MSG_SAVE')+ (rotaryIndex + 1));
		self.commandRouter.pushToastMessage('success', self.getI18nString('ROTARYENCODER2.TOAST_SAVE_SUCCESS'), self.getI18nString('ROTARYENCODER2.TOAST_MSG_SAVE')+ (rotaryIndex + 1));
		defer.resolve();	
	})
	.fail(err => {
		self.commandRouter.pushToastMessage('error', self.getI18nString('ROTARYENCODER2.TOAST_SAVE_FAIL'), self.getI18nString('ROTARYENCODER2.TOAST_MSG_SAVE')+ (rotaryIndex + 1));
		defer.reject(err);
	})
	return defer.promise;

}

//Checks if the user settings in the GUI make sense -----------------------------------------------------------------------------------
rotaryencoder2.prototype.sanityCheckSettings = function(rotaryIndex, data){
	var self = this;
	var defer = libQ.defer();
	var newPins = [];
	var otherPins = [];
	var allPins = [];

	if (self.debugLogging) self.logger.info('[ROTARYENCODER2] sanityCheckSettings: Rotary'+(rotaryIndex + 1)+' for:' + JSON.stringify(data));

	//Disabling rotaries is always allowed
	if (data['enabled'+rotaryIndex] == false) {
		if (self.config.get('enabled'+rotaryIndex) == true) {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] sanityCheckSettings: Disabling rotary ' + (rotaryIndex+1) +' is OK.' );
			defer.resolve();	
		} else {
			if (self.debugLogging) self.logger.info('[ROTARYENCODER2] sanityCheckSettings: Rotary ' + (rotaryIndex+1) +' was already disabled, nothing to do.' );
			defer.resolve();	
		} 
	} else {
		if (data['pinPush'+rotaryIndex] == '') {
			data['pinPush'+rotaryIndex] = '0' //if pinPush is empty, set it to 0 (disabled)
		}
		//check if GPIO pins are integer
		if (!Number.isInteger(parseInt(data['pinA'+rotaryIndex])) || !Number.isInteger(parseInt(data['pinB'+rotaryIndex])) || !Number.isInteger(parseInt(data['pinPush'+rotaryIndex]))) {
			self.commandRouter.pushToastMessage('error', self.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.getI18nString('ROTARYENCODER2.TOAST_NEEDS_INTEGER'));
			if (self.debugLogging) self.logger.error('[ROTARYENCODER2] sanityCheckSettings: Pin values must be Integer ' );
			defer.reject('Pin value must be integer.');
		} else { 
			newPins.push(parseInt(data['pinA'+rotaryIndex]));
			newPins.push(parseInt(data['pinB'+rotaryIndex]));
			if (data['pinPush'+rotaryIndex] > 0) {
				newPins.push(parseInt(data['pinPush'+rotaryIndex]));
			}
			for (let i = 0; i < maxRotaries; i++) {
				if ((!i==rotaryIndex) && (this.config.get('enabled'+i))) {
					otherPins.push(parseInt(this.config.get('pinA'+i)));
					otherPins.push(parseInt(this.config.get('pinB'+i)));
					otherPins.push(parseInt(this.config.get('pinPush'+i)));
				}
			}
			//check if duplicate number used
			if (newPins.some((item,index) => newPins.indexOf(item) != index)) {
				self.commandRouter.pushToastMessage('error', self.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.getI18nString('ROTARYENCODER2.TOAST_PINS_DIFFERENT'));
				self.logger.error('[ROTARYENCODER2] sanityCheckSettings: duplicate pins. new: ' + newPins );
				defer.reject('Duplicate pin numbers provided.');
			} else {
				//check if any of the numbers used is also used in another active rotary
				allPins = [...otherPins, ...newPins];
				if (allPins.some((item,index) => allPins.indexOf(item) != index)) {
					self.commandRouter.pushToastMessage('error', self.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.getI18nString('ROTARYENCODER2.TOAST_PINS_BLOCKED'));
					self.logger.error('[ROTARYENCODER2] sanityCheckSettings: Pin(s) used in other rotary already.');
					defer.reject('One or more pins already used in other rotary.')
				} else {
					//check if Rotary Type is selected
					if (![1,2,4].includes(data['rotaryType'+rotaryIndex].value)) {
						self.commandRouter.pushToastMessage('error', self.getI18nString('ROTARYENCODER2.TOAST_WRONG_PARAMETER'), self.getI18nString('ROTARYENCODER2.TOAST_NO_TYPE'));
						self.logger.error('[ROTARYENCODER2] sanityCheckSettings: Periods per tick not set.');
						defer.reject('Must select periods per tick.')
					} else {		
						data['pinPushDebounce'+rotaryIndex] = Math.max(0,data['pinPushDebounce'+rotaryIndex]);
						data['pinPushDebounce'+rotaryIndex] = Math.min(1000,data['pinPushDebounce'+rotaryIndex]);
						defer.resolve('pass');	
					}
				}		
			}
		}				
	}
	return defer.promise;
}





