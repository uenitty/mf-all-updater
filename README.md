# mf-all-updater

```sh
# .env
EMAIL=
PASSWORD=
```

```sh
$ mise run update_account
```

```sh
$ crontab -e

30 */6 * * * zsh -l ~/Development/mf-all-updater/script/update_account.sh
```
