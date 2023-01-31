#!/bin/bash

echo "Installing PapyRadio dependencies"
echo "unload Loopback module if exists"
sudo rmmod snd_aloop

libpath=/PapyRadio
derrormess="Failed to extract caps"
echo "Detecting cpu"
cpu=$(lscpu | awk 'FNR == 1 {print $2}')
#echo "$cpu is the cpu"

if [ $cpu = "armv6l" ] || [ $cpu = "armv7l" ] || [ $cpu = "aarch64" ] || [ $cpu = "i686" ];
then
	cd $libpath
        echo "Cpu is $cpu, installing required caps version."
	sudo cp /PapyRadio/caps-$cpu.tar /caps.tar
	cd /
	sudo tar xvf caps.tar
	sudo rm /caps.tar
	if [ $? -eq 0 ]
		then
			echo "Extracting data"
		else
			echo "$derrormess"
			exit -1
		fi

else

	echo "Unsupported cpu ($cpu)"
	exit -1
fi

if [ ! -f "/PapyRadio/config.json" ];
	then
		echo "file doesn't exist, nothing to do"
	else
		echo "File exists removing it"
		sudo rm /PapyRadio/config.json
fi
echo "Checking if radios services exist"
if [ ! -f "/etc/systemd/system/volparametriceq.service" ];
	then
		echo "file volparametriceq.service doesn't exist, creating"
		cp /PapyRadio/radios.tar.gz /
		cd /
		sudo tar -xvf radios.tar.gz
	else
		echo "volparametriceq.service removing to install new version !"
		sudo rm /etc/systemd/system/volparametriceq.service
		cp /PapyRadio/radios.tar.gz /
		cd /
		sudo tar -xvf radios.tar.gz
		rm /radios.tar.gz
fi
sudo systemctl daemon-reload
#required to end the plugin install
echo "plugininstallend"
