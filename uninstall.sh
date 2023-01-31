#!/bin/bash

echo "Unistalling papyradio dependencies"

echo "Removing papyradio"

systemctl stop papyradio

sudo rm /etc/systemd/system/volparametriceq.service
echo "Done"
echo "pluginuninstallend"
