#!/bin/zsh -l

cd `dirname $0`

echo -e "`date`" > log.txt

yarn update >> log.txt 2>&1
