# English Time Etüt Sistemi

Öğrenci etüt kayıt sistemi. **Bildirimler yalnızca SMS ile gönderilir (Netgsm).**

## Neden WhatsApp yok?

Meta'nın WhatsApp Cloud API'si, size son 24 saat içinde mesaj yazmamış
birine serbest metin göndermenize izin vermez. Öğretmenler okula WhatsApp'tan
yazmadığı için bu kural bildirimleri kullanılamaz hale getirir. Aşmak için
kayıtlı bir SIM ve Meta tarafından onaylanmış şablonlar gerekir — SMS'in
anında yaptığı işi günler süren bir kuruluma çevirir.

## SMS karakter kuralı

Bir SMS **160 karakterdir**. Metinde ğ ş ı İ ç ö ü gibi Türkçe karakterler
varsa limit **70 karaktere** düşer — yani aynı mesaj 3 SMS olarak faturalanır.

Bu yüzden tüm şablonlar Türkçe karaktersiz yazılmıştır ("etudunuz"). Sunucu
şablona yazılan Türkçe karakterleri de otomatik olarak sadeleştirir.

## Netgsm kurulumu

1. netgsm.com.tr üzerinden hesap açın
2. Kontör yükleyin (SMS ön ödemelidir)
3. **Gönderici adı (başlık)** başvurusu yapın — örn. ENGLISHTIME.
   BTK onayı gerekir, birkaç iş günü sürer, firma evrakı istenir.
4. Yönetim panelinde: SMS sağlayıcı → Netgsm, kullanıcı kodu, şifre ve
   başlık alanlarını doldurun
5. "Öğrenci SMS testi" ile kendi numaranıza deneme gönderin

Başlık onaylanana kadar sistem test modunda kalır: mesajlar gönderilmez,
"Mesajlar" sekmesinde görünür.


## 1 · Put the code on GitHub (5 min)

1. Go to <https://github.com> → sign up / log in.
2. Click **New repository** → name it `english-time-etut` → **Create repository**.
3. On the new repo page click **uploading an existing file**, drag **all the files in this folder** (not the folder itself, the files inside it: `server.js`, `db.js`, `messaging.js`, `package.json`, `render.yaml`, `README.md` and the `public` folder) → **Commit changes**.

## 2 · Create the free database (3 min)

1. Go to <https://neon.tech> → **Sign up** (with Google/GitHub is easiest).
2. **Create project** → name `english-time-etut` → region **Europe (Frankfurt)** → Create.
3. On the dashboard click **Connect** → copy the **connection string** (starts with `postgresql://…`). Keep it, you need it in the next step.

## 3 · Put the website online (5 min)

1. Go to <https://render.com> → **Sign up** with GitHub.
2. **New +** → **Web Service** → connect your `english-time-etut` repository.
3. Settings: Name `english-time-etut` · Region **Frankfurt** · Instance type **Free** · Build command `npm install` · Start command `npm start`.
4. Scroll to **Environment Variables** → **Add**:
   - `DATABASE_URL` = the Neon connection string you copied
   - `ADMIN_PASSWORD` = the first admin password you want (you can change it later in the panel)
5. Click **Deploy Web Service**. After 2–3 minutes you get a link like `https://english-time-etut.onrender.com` — that is your site.

> Free tip: Render's free plan "sleeps" after 15 minutes without visitors; the first student to scan after a quiet period waits ~30 seconds while it wakes up. To keep it awake for free, go to <https://uptimerobot.com>, add a monitor for your site URL, every 5 minutes.

## 4 · First setup in the admin panel (5 min)

1. Open `https://YOUR-SITE.onrender.com/admin` → log in with the password from step 3.
2. **Ayarlar** → enter the coordinator's WhatsApp number, check the classrooms, save.
3. **Öğretmenler** → add each teacher with their WhatsApp number.
4. **Program** → click each etüt box → choose its teacher → Kaydet. (The schedule from your printed timetable is already loaded.)
5. **Genel bakış** → **QR'ı indir** → print it → pin it on the notice board. Done.

## 5 · Turn on real SMS and WhatsApp (when you are ready)

Until you do this, the system runs in **test mode**: everything works, but messages are only shown in the **Mesajlar** tab instead of being sent.

**SMS (Netgsm)** — <https://www.netgsm.com.tr>
1. Open an account, buy an SMS package, and request a sender name (e.g. `ENGLISHTIME`) — Netgsm asks for company documents, approval takes ~1–2 days.
2. In the admin panel → **Ayarlar** → SMS sağlayıcı: *Netgsm* → enter usercode (your Netgsm phone number), password, and the approved header → **Ayarları kaydet** → send a test with "SMS testi".

Any other Turkish provider works too (İleti Merkezi, Verimor…) — tell me which and I'll swap the 20 lines in `messaging.js`.

**WhatsApp (Meta Cloud API)** — free for the first 1000 conversations/month
1. <https://business.facebook.com> → create a business portfolio → <https://developers.facebook.com> → **Create App** → type *Business* → add **WhatsApp** product.
2. In WhatsApp → API Setup: add the school's phone number, copy **Phone number ID** and generate a **permanent access token** (System user → Generate token, permission `whatsapp_business_messaging`).
3. Recipients (teachers + coordinator) must reply once to the business number, or you must use an approved message template; easiest is to have them send "Merhaba" to the school's WhatsApp number once.
4. Admin panel → **Ayarlar** → WhatsApp sağlayıcı: *Meta* → paste Phone Number ID + token → save → "WhatsApp testi".

## Everyday use for the coordinator

| Want to… | Where |
|---|---|
| Cancel an etüt (students see a red line and a "cancelled by the Educational Coordinator" message) | Program → click box → tick *iptal edildi* |
| Change teacher / time / level / day / classroom / capacity | Program → click box |
| Add or remove an etüt | Program → *Yeni etüt ekle* / *Sil* |
| Change teachers' phone numbers | Öğretmenler |
| See who registered, delete a registration | Kayıtlar |
| Download Excel | Genel bakış or Kayıtlar → *Excel indir* |
| Check SMS/WhatsApp sent | Mesajlar |
| Change password, level rule, earliest-booking rule, SMS text | Ayarlar |

## Rules built in

- Names: letters only. Phone: must be `05XX XXX XX XX`.
- Students can only pick slots for **their level or one level above** (B1 → B1, B2). Changeable in Ayarlar.
- Earliest bookable etüt is **tomorrow** (changeable). Each chosen day is booked for its next date.
- Unlimited number of slots per registration; the same phone can't book the same slot twice.
- Cancelled and full slots cannot be booked, and the server double-checks everything.

## Running on your own computer (optional, for testing)

```
npm install
set DATABASE_URL=postgresql://...      (Windows)   |  export DATABASE_URL=postgresql://...  (Mac)
npm start
```
then open <http://localhost:3000>.
