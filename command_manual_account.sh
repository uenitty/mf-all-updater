#!/bin/zsh -l

cd `dirname $0`

echo -e "`date`" > log.txt

HEADLESS=true yarn update_manual_account >> log.txt 2>&1
