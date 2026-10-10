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

Instaluesi QA pa nënshkrim nuk zëvendëson dorëzimin me nënshkrim të besuar Windows. Mos çaktivizo sigurinë e pajisjes për ta hapur.
