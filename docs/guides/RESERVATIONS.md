# Rezervimi i tavolinave

1. Te **Tavolinat**, zgjidh një tavolinë të lirë.
2. Shtyp **Rezervo tavolinën**.
3. Shëno emrin, datën/orën dhe numrin e personave. Telefoni dhe shënimi janë opsionalë.
4. Shtyp **Ruaj rezervimin**. Tavolina shënohet **Rez.** në hartë; paneli ruan detajet e klientit.
5. Kur klienti vjen, shtyp **Klienti mbërriti**, pastaj shto produktet në porosi si zakonisht.
6. Nëse klienti anulon, shtyp **Anulo rezervimin**.

Rezervimi mbahet menjëherë dhe nuk lirohet automatikisht kur kalon ora. Për çdo tavolinë mbahet vetëm një rezervim i hapur. Tavolinat me porosi aktive ose joaktive nuk mund të rezervohen. Për ta ndryshuar rezervimin, anuloje dhe regjistro detajet e reja.

Rezervimet ruhen pas rinisjes dhe përfshihen në backup. Mbërritjet dhe anulimet ruhen në historik. Rezervimi nuk krijon porosi, pagesë, shpenzim ose lëvizje stoku. Pagesa dhe zbritja e stokut bëhen përmes checkout-it ekzistues.

## Integrimi

Versioni 0.7.1-rc.1 shton migrimin 6 me `table_reservations`, pa ndryshuar migrimet 1–5. Përditësimi i një baze ekzistuese krijon backup përpara migrimit. Kodet M1–M13, SH1–SH4 dhe T1–T10 ruhen.

`npm run verify:reservations` verifikon rezervimin në Electron në një profil QA të izoluar. `node scripts/qa/verify-reservations.mjs <installer.exe>` kontrollon të njëjtin proces në instaluesin Windows. Të dy kontrollet janë pjesë e workflow-it Windows QA.
