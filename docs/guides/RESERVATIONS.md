# Rezervimi i tavolinave

1. Te **Tavolinat**, zgjidh njÃ« tavolinÃ« tÃ« lirÃ«.
2. Shtyp **Rezervo tavolinÃ«n**.
3. ShÃ«no emrin, datÃ«n/orÃ«n dhe numrin e personave. Telefoni dhe shÃ«nimi janÃ« opsionalÃ«.
4. Shtyp **Ruaj rezervimin**. Tavolina shÃ«nohet **Rez.** nÃ« hartÃ«; paneli ruan detajet e klientit.
5. Kur klienti vjen, shtyp **Klienti mbÃ«rriti**, pastaj shto produktet nÃ« porosi si zakonisht.
6. NÃ«se klienti anulon, shtyp **Anulo rezervimin**.

Rezervimi mbahet menjÃ«herÃ« dhe nuk lirohet automatikisht kur kalon ora. PÃ«r Ã§do tavolinÃ« mbahet vetÃ«m njÃ« rezervim i hapur. Tavolinat me porosi aktive ose joaktive nuk mund tÃ« rezervohen. PÃ«r ta ndryshuar rezervimin, anuloje dhe regjistro detajet e reja.

Rezervimet ruhen pas rinisjes dhe pÃ«rfshihen nÃ« backup. MbÃ«rritjet dhe anulimet ruhen nÃ« historik. Rezervimi nuk krijon porosi, pagesÃ«, shpenzim ose lÃ«vizje stoku. Pagesa dhe zbritja e stokut bÃ«hen pÃ«rmes checkout-it ekzistues.

## Integrimi

Versioni 0.7.1-rc.1 shton migrimin 6 me `table_reservations`, pa ndryshuar migrimet 1â€“5. PÃ«rditÃ«simi i njÃ« baze ekzistuese krijon backup pÃ«rpara migrimit. Kodet M1â€“M13, SH1â€“SH4 dhe T1â€“T10 ruhen.

`npm run verify:reservations` verifikon rezervimin nÃ« Electron nÃ« njÃ« profil QA tÃ« izoluar. `node scripts/qa/verify-reservations.mjs <installer.exe>` kontrollon tÃ« njÃ«jtin proces nÃ« instaluesin Windows. TÃ« dy kontrollet janÃ« pjesÃ« e workflow-it Windows QA.
