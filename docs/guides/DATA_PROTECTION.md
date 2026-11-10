# Mbrojtja e tÃ« dhÃ«nave tÃ« FOX

FOX i ruan tÃ« dhÃ«nat nÃ« kÃ«tÃ« llogari Windows, veÃ§mas nga skedarÃ«t e aplikacionit. Ã‡instalimi heq programin, por ruan historikun. Riinstalimi e hap sÃ«rish tÃ« njÃ«jtÃ«n gjendje; nuk krijon automatikisht njÃ« fillim bosh.

## Krijimi i backup-it

Te **CilÃ«simet â†’ TÃ« dhÃ«nat â†’ Krijo backup**, zgjidh njÃ« emÃ«r tÃ« ri `.sqlite`. Prit **Backup u krijua dhe u verifikua**. Ruaj sÃ« bashku skedarin dhe shoqÃ«ruesin `.sqlite.json`. FOX nuk mbishkruan backup ekzistues.

Krijo backup para pÃ«rditÃ«simit, pas ndryshimeve tÃ« rÃ«ndÃ«sishme nÃ« produkte/stok dhe rregullisht, praktikisht nÃ« fund tÃ« Ã§do dite. Para klientit tÃ« parÃ« ruaj **FOX-PRE-GO-LIVE-data-ora.sqlite**, me konfigurimin e kontrolluar dhe pa shitje prove. Ruaj njÃ« kopje jashtÃ« laptopit, pÃ«r shembull nÃ« USB tÃ« mbrojtur. Backup-i pÃ«rmban historikun e biznesit; mos e shpÃ«rndaj pa nevojÃ«. FOX nuk e ngarkon nÃ« internet.

## Rikthimi nga backup-i

Rikthimi e zÃ«vendÃ«son gjendjen aktuale me atÃ« tÃ« backup-it. Shitjet pas datÃ«s sÃ« backup-it nuk shfaqen nÃ« gjendjen e rikthyer. Mos e pÃ«rdor si provÃ« gjatÃ« punÃ«s me klientÃ«.

PÃ«rfundo porositÃ« e hapura. Zgjidh **Rikthe nga backup**, kontrollo skedarin dhe datÃ«n. FOX verifikon backup-in, kÃ«rkon konfirmim dhe krijon backup sigurie tÃ« gjendjes aktuale. **Anulo** Ã«shtÃ« zgjedhja fillestare. Pas rikthimit FOX riniset. Kontrollo produktet, stokun, shitjet dhe printerin pÃ«rpara rifillimit.

Backup-i i dÃ«mtuar, i paplotÃ« ose i njÃ« programi tjetÃ«r refuzohet. NÃ«se rikthimi dÃ«shton, mos fshi apo ndrysho skedarÃ« pÃ«r ta detyruar; ruaj gjendjen dhe kÃ«rko ndihmÃ«. Mos printo kuponÃ« tÃ« vjetÃ«r pa kontrolluar nÃ«se janÃ« printuar mÃ« parÃ«.

## Ã‡farÃ« nuk duhet fshirÃ«

Mos fshi skedarÃ«t e tÃ« dhÃ«nave, skedarÃ«t shoqÃ«rues, dosjen e rikuperimit ose backup-et pÃ«r tÃ« zgjidhur problem nisjeje. Mos kopjo tÃ« dhÃ«nat e zhvillimit/provave te pajisja e lokalit. Instalimi i ri pÃ«r punÃ« kÃ«rkon gjendje tÃ« pastÃ«r, tÃ« verifikuar; instalimi me histori kÃ«rkon kontroll dhe ruajtje, jo pastrim automatik.

PÃ«r mbÃ«shtetje teknike, tÃ« dhÃ«nat zakonisht janÃ« te `%APPDATA%\FOX Kafeteri`; vendndodhja e saktÃ« shfaqet te **Gjendja dhe diagnostika**. [Dokumentacioni teknik](../architecture/DATA_PROTECTION_TECHNICAL.md) Ã«shtÃ« pÃ«r personin qÃ« ofron mbÃ«shtetje.

## HapÃ«sira dhe privatÃ«sia

Backup-et qÃ« zgjedh tÃ« krijosh nuk fshihen automatikisht. Kontrollo hapÃ«sirÃ«n e diskut dhe mbaj disa kopje tÃ« verifikuara, pÃ«rfshirÃ« njÃ« kopje jashtÃ« laptopit. Mos fshi kopjen e fundit tÃ« mirÃ«. Para pastrimit, verifiko kopjen qÃ« do tÃ« mbash.

NÃ«se backup-i nuk krijohet nÃ« njÃ« dosje shumÃ« tÃ« thellÃ« ose me emÃ«r shumÃ« tÃ« gjatÃ«, provo njÃ« dosje tÃ« shkurtÃ«r me emÃ«r tÃ« thjeshtÃ«, pÃ«r shembull nÃ« USB. Prit gjithmonÃ« mesazhin e verifikimit; vetÃ«m mbyllja e dritares sÃ« zgjedhjes nuk do tÃ« thotÃ« se backup-i u krijua.

Backup-i pÃ«rmban edhe kontaktet e rezervimeve. Ruaje nÃ« vend tÃ« mbrojtur dhe jepja vetÃ«m personit tÃ« autorizuar. Diagnostika e zakonshme kufizohet dhe rrotullohet automatikisht; nuk kÃ«rkohet pastrim me komanda.
