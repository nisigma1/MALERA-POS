# Përgatitja e FOX për punë

1. Hape FOX në pajisjen e lokalit. Kontrollo versionin te **Cilësimet → Gjendja dhe diagnostika**. Instalimi i ri duhet të ketë 27 tavolina, 21 produkte dhe Raporte pa shitje. Nëse shihen shitje të mëparshme, ndalo dorëzimin dhe kërko kontroll; mos i fshi.
2. Te **Inventari → Edito**, kontrollo emrin dhe statusin e secilit produkt. Produktet që nuk do të shiten vendosi **Joaktiv**. Historiku i tyre mbetet i ruajtur.
3. Vendos çmimin real të shitjes. Pranohen pika ose presja për qindarkat. Bosh do të thotë **Pa çmim**; produkti aktiv nuk mund të shitet pa çmim.
4. Vendos çmimin e blerjes kur e di. Lëre bosh kur nuk e di; nuk trajtohet si zero. Kjo nuk pengon shitjen, por kufizon llogaritjen e fitimit. Ndryshimi sot nuk plotëson kostot e shitjeve të kaluara.
5. Te **Ndjek stokun**, zgjidh **Po** ose **Jo** për çdo produkt aktiv. Po zbrit sasinë kur paguhet porosia. Jo lejon shitjen pa numërim stoku. Pa konfiguruar kërkon zgjedhje.
6. Për produktet me Po, numëro sasinë reale dhe përdor **Shto furnizim**. Për stok të pavendosur ky është stoku fillestar. Për stok ekzistues furnizimi shton sasi; mos e regjistro të njëjtën sasi përsëri. Kontrollo përmbledhjen para konfirmimit.
7. Nëse dëshiron, vendos pragun e stokut të ulët. Ai është opsional. Stoku i panjohur pengon shitjen e produktit të ndjekur; stoku zero kërkon furnizim për ta shitur.
8. Te **Cilësimet → Gati për shitje**, zgjidh mungesat e çmimeve dhe konfigurimit të stokut. Kontrollo që shfaqet **Gati për fillimin e punës**. Shqyrto veçmas kostot e panjohura, pragjet dhe produktet pa stok.
9. Para shitjes së parë, kontrollo që Raportet janë ende pa shitje. Krijo **FOX-PRE-GO-LIVE-data-ora.sqlite**. Prit **Backup u krijua dhe u verifikua**; ruaj edhe skedarin shoqërues në USB ose vend tjetër të sigurt. Shih [Mbrojtja e të dhënave](DATA_PROTECTION.md).
10. Pronari kontrollon konfigurimin dhe plotëson [listën e dorëzimit](GO_LIVE_CHECKLIST.md). Fillo vetëm pasi janë zgjidhur pengesat. Mos bëj shitje prove në gjendjen për klientë.

Nëse përdor printer, ruaje dhe provo një kupon në letër para printimit automatik. Kuponi është jo-fiskal. Kontrollo që testi nuk ka krijuar shitje prove.

Te **Cilësimet**, kontrollo emrin dhe të dhënat e biznesit që do të shfaqen në kupon. Shëno vetëm të dhëna të sakta. Për rezervim telefonik, zgjidh tavolinën te **Tavolinat → Rezervo tavolinën** dhe shëno klientin, orën dhe personat. Kur klienti vjen ose anulon, përditëso rezervimin; pagesa bëhet vetëm për porosinë.

Instaluesi QA pa nënshkrim nuk zëvendëson dorëzimin me nënshkrim të besuar Windows. Mos çaktivizo sigurinë e pajisjes për ta hapur.

## Kontrolli financiar i pronarit

Te **Raportet → Shpenzimet**, regjistro qiranë, pagat, energjinë dhe shpenzimet operative. Zgjidh **Nga arka** vetëm kur paratë janë marrë fizikisht nga arka; **Tjetër** ul rezultatin operativ, por jo arkën. **Korrigjo** ruan origjinalin në histori dhe zëvendëson shumën efektive, pa numërim të dyfishtë.

Blerjet e mallit regjistrohen te **Inventari → Shto furnizim**, jo si shpenzime. Nëse paguan nga arka, shëno **Paguar nga arka** dhe vendos shumën reale të paguar. FOX nuk e hamendëson pagesën nga sasia ose çmimi i blerjes. Furnizimi rrit stokun; kostoja hyn në rezultat vetëm kur malli shitet.

Te **Inventari → Regjistro humbje**, zgjidh produktin, sasinë dhe arsyen e dëmtimit/skadimit. Kjo ul stokun pa krijuar shitje ose dalje parash. Kostoja ruhet në momentin e humbjes; kur nuk dihet, shfaqet si e paplotë.

Te **Raportet → Mbyllja e arkës → Lëvizje arke**, regjistro para që pronari fut ose merr, me arsyen. Mos fut përsëri shitje, shpenzime ose furnizime: FOX i regjistron automatikisht. Hyrja nuk është shitje; tërheqja nuk është shpenzim.

Në fund të punës, mbyll/anulo të gjitha porositë aktive. Te **Mbyllja e arkës**, konfirmo paratë fillestare të këtij sesioni dhe vendos shumën që numërove fizikisht. FOX shfaq gjendjen e pritur dhe ruan diferencën: përputhet, mungesë ose tepricë. Sesioni hapet automatikisht nga aktiviteti i parë dhe mund të kalojë mesnatën. Gjendja e numëruar nga mbyllja e fundit është vetëm sugjerim; mos e përdor pa kontrolluar paratë që mbetën. Mbylljet historike nuk ndryshohen. Korrigjimi i parasë regjistrohet me arsye në sesionin aktual.

**Rezultati operativ** = shitje − kosto historike e mallit të shitur − shpenzime të regjistruara − humbje stoku. Vlera negative tregon humbje operative. Kur mungojnë kosto, FOX shfaq **Kosto të paplota**, jo fitim të rremë. Ky është kontroll operativ, jo fitimi neto ligjor/tatimor. Paratë në arkë janë tjetër gjë: përfshijnë gjendjen fillestare dhe hyrjet/daljet fizike. Filtri i raporteve nuk ndryshon kufijtë e sesionit të arkës.

Historiku i vjetër nuk merr mbyllje ose gjendje fillestare të shpikura. Kontrolli i arkës fillon nga aktiviteti i ri në këtë version. Backup-i i zakonshëm ruan edhe shpenzimet, korrigjimet, humbjet, lëvizjet dhe sesionet e arkës.
