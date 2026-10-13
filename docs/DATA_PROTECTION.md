# Mbrojtja e të dhënave të FOX

FOX i ruan të dhënat në këtë llogari Windows, veçmas nga skedarët e aplikacionit. Çinstalimi heq programin, por ruan historikun. Riinstalimi e hap sërish të njëjtën gjendje; nuk krijon automatikisht një fillim bosh.

## Krijimi i backup-it

Te **Cilësimet → Të dhënat → Krijo backup**, zgjidh një emër të ri `.sqlite`. Prit **Backup u krijua dhe u verifikua**. Ruaj së bashku skedarin dhe shoqëruesin `.sqlite.json`. FOX nuk mbishkruan backup ekzistues.

Krijo backup para përditësimit, pas ndryshimeve të rëndësishme në produkte/stok dhe rregullisht, praktikisht në fund të çdo dite. Para klientit të parë ruaj **FOX-PRE-GO-LIVE-data-ora.sqlite**, me konfigurimin e kontrolluar dhe pa shitje prove. Ruaj një kopje jashtë laptopit, për shembull në USB të mbrojtur. Backup-i përmban historikun e biznesit; mos e shpërndaj pa nevojë. FOX nuk e ngarkon në internet.

## Rikthimi nga backup-i

Rikthimi e zëvendëson gjendjen aktuale me atë të backup-it. Shitjet pas datës së backup-it nuk shfaqen në gjendjen e rikthyer. Mos e përdor si provë gjatë punës me klientë.

Përfundo porositë e hapura. Zgjidh **Rikthe nga backup**, kontrollo skedarin dhe datën. FOX verifikon backup-in, kërkon konfirmim dhe krijon backup sigurie të gjendjes aktuale. **Anulo** është zgjedhja fillestare. Pas rikthimit FOX riniset. Kontrollo produktet, stokun, shitjet dhe printerin përpara rifillimit.

Backup-i i dëmtuar, i paplotë ose i një programi tjetër refuzohet. Nëse rikthimi dështon, mos fshi apo ndrysho skedarë për ta detyruar; ruaj gjendjen dhe kërko ndihmë. Mos printo kuponë të vjetër pa kontrolluar nëse janë printuar më parë.

## Çfarë nuk duhet fshirë

Mos fshi skedarët e të dhënave, skedarët shoqërues, dosjen e rikuperimit ose backup-et për të zgjidhur problem nisjeje. Mos kopjo të dhënat e zhvillimit/provave te pajisja e lokalit. Instalimi i ri për punë kërkon gjendje të pastër, të verifikuar; instalimi me histori kërkon kontroll dhe ruajtje, jo pastrim automatik.

Për mbështetje teknike, të dhënat zakonisht janë te `%APPDATA%\FOX Kafeteri`; vendndodhja e saktë shfaqet te **Gjendja dhe diagnostika**. [Dokumentacioni teknik](DATA_PROTECTION_TECHNICAL.md) është për personin që ofron mbështetje.

## Hapësira dhe privatësia

Backup-et që zgjedh të krijosh nuk fshihen automatikisht. Kontrollo hapësirën e diskut dhe mbaj disa kopje të verifikuara, përfshirë një kopje jashtë laptopit. Mos fshi kopjen e fundit të mirë. Para pastrimit, verifiko kopjen që do të mbash.

Backup-i përmban edhe kontaktet e rezervimeve. Ruaje në vend të mbrojtur dhe jepja vetëm personit të autorizuar. Diagnostika e zakonshme kufizohet dhe rrotullohet automatikisht; nuk kërkohet pastrim me komanda.
