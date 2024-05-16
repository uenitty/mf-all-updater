#!/bin/zsh -l

cd `dirname $0`

echo -e "`date`" > log.txt

yarn update_account >> log.txt 2>&1
