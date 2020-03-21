Projecte que et permet descarregar videos desde la web de TV3. Actualment està configurat per desacrregar la sèrie infantil *Germans Kratt*.

## Configuració

Aquest projecte requereix de NodeJS per a la seva execució. Així mateix, donat que fa us de la llibreria *NickJS* es requereix un fitxer `.env` amb el següent contingut:

```
CHROME_PATH=<path to chrome/chromium executable file>
```

La variable `CHROME_PATH ha d'apuntar al fitxer executable del navegador que trïis: Google Chrome o Chromium.

Enjoy!
