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





