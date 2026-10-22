# تشغيل أكتر من نسخة من الـ API (Multi-instance) — دليل التشغيل

> الوضع الافتراضي: **مقفول**. السيرفر شغال بوحدة واحدة `mahad-api` على 3001 (و`mahad-api-staging` على 3002) زي ما هو بالظبط. مفيش سكريبت بيشغّل أي حاجة من اللي هنا لوحده. كل اللي تحت خطوات يدوية على السيرفر.

## الفكرة في سطرين

- الوحدة الحالية `mahad-api` (بورت 3001) تفضل زي ما هي، وهي اللي ماسكة **واتساب المندوبين** و(لو مفيش worker) **المهام المجدولة**.
- نضيف نسخة ويب (أو أكتر) من القالب `mahad-api@.service`؛ اسم النسخة هو البورت: `mahad-api@3011` بتسمع على 3011. النسخة دي HTTP بس (`MAHAD_ROLE=web`)، ومن غير واتساب (`MAHAD_WA_WEB=0`).
- nginx يوزّع الطلبات على 3001 و3011، ويثبّت `/api/staff/whatsapp-web/` على 3001.
- `deploy-release.sh` بيلاقي النسخ المفعّلة لوحده، وبعد تبديل الفولدر يعمل restart للوحدة الرئيسية، يستنى لحد ما ترد، وبعدين كل نسخة بالدور — فدايمًا فيه نسخة بترد.

## إيه اللي اتعمل في الكود عشان أكتر من نسخة تبقى صح

| الحالة اللي كانت في ذاكرة البروسيس | المشكلة مع نسختين | الحل |
|---|---|---|
| عدّادات الـ rate limit (`middleware/rateLimits.js`) | كل نسخة بتعدّ لوحدها → الحد بيتضاعف (30 محاولة دخول بدل 15) | مع `MAHAD_MULTI_INSTANCE=1` العدّ في جدول `rate_limit_counters` (migration 330) — upsert واحد لكل طلب، العدد راجع من نفس الجملة. اتقاس محليًا: ~0.7ms للطلب مقابل ~0.001ms في الذاكرة، ودقيق مع 190 طلب في نفس اللحظة. لو الداتابيز وقعت بيعدّ في الذاكرة بدل ما يرفض الكل. Redis لو اتفعّل بيكسب. النسخة الواحدة لسه بتعدّ في الذاكرة. |
| مين أونلاين (`lib/onlineUsers.js`) | كل نسخة شايفة نص الناس | جدول `online_presence` (migration 332) لما `MAHAD_MULTI_INSTANCE=1` ومفيش Redis |
| الكاش (`cached` في `lib/db.js` وكاشات الإعدادات) | حفظ سعر/إعداد بيمسح الكاش في النسخة اللي استلمت الحفظ بس | `lib/cacheBus.js`: كل مسح بيتكتب صف في `cache_invalidations` (migration 331) وكل بروسيس بيقرا الجديد كل ثانيتين ويمسح نسخته. متوصّل بـ: الكتالوج والأسعار والفروع ومحتوى الموقع والـ tenants (`cached`)، الهوية، إعدادات واتساب، الإيميل، lifecycle، Meta CAPI، قايمة الـ IP، سياق الـ tenant، أسعار الصرف، صلاحيات الحذف، سياسة الـ MFA، صلاحيات الأدوار، قوالب الرسايل، و**التوكن اللي اتعمله تسجيل خروج** (كان بيفضل شغال على النسخة التانية لحد ما يخلص). بيشتغل لوحده بس لما يكون فيه بروسيس تاني (worker أو نسخة تانية). |
| كاشات قصيرة تانية: أرقام اللوحة `figures:` (15 ثانية)، geoip، أسماء الموظفين، إحصائيات `performanceMonitor` و`errorMonitor` | مقبول: محدودة بوقت، أو إحصائيات لكل بروسيس | زي ما هي. صفحة «مراقبة السيرفر» بتعرض أرقام النسخة اللي ردّت (الهيدر `X-Mahad-Instance` بيقول مين) |
| تايمرز جنب الراوتس (التقرير اليومي، التذكيرات، SLA، الشهادات، الدقي، مراجعة المدفوعات، تذاكر الدعم) | كانت بتبدأ مع تحميل الراوتس → كل نسخة ويب بتبعتها | بتبدأ من `lib/routeJobs.js` في البروسيس اللي ماسك المهام بس (`MAHAD_ROLE=all` أو الـ worker). مزامنة الشيتات والمصروفات المتكررة عليهم قفل أصلًا |
| جلسات واتساب المندوبين (`lib/whatsappWeb.js`) | لازم بروسيس واحد بس | `MAHAD_WA_WEB=1` على نسخة واحدة (أو فاضي = زي الأول، القفل بيقرر)، و`0` على الباقي. أي طلب واتساب يوصل لنسخة `0` بيرجع 503 `WA_WEB_OTHER_INSTANCE` برسالة واضحة — يعني توجيه nginx ناقص |
| Socket.io | مش في الـ API — `ws-server` خدمة لوحدها والـ API بيبعتلها HTTP | مفيش تغيير |
| الإيقاف (SIGTERM) | | البروسيس بيقفل الـ listener (nginx يروح للنسخة التانية)، يكمّل الطلبات اللي شغالة لحد `SHUTDOWN_DRAIN_MS` (10 ثواني)، كل رد بيتبعت بـ `Connection: close`، و`/api/health` يرد 503 `draining` |

## التشغيل — production (staging نفس الخطوات بـ 3002/3012 و`mahad-api-staging`)

كل الأوامر root على السيرفر، في وقت هادي.

1. **اتأكد إن البورت فاضي وإن فيه ذاكرة:**
   ```bash
   ss -ltnp | grep -E ':3011\b' || echo "3011 فاضي"
   free -m          # كل نسخة لحد 1.2GB (MemoryMax في الوحدة)
   ```
2. **انقل الملفات من اللابتوب** (من فولدر الريبو):
   ```bash
   scp deploy/systemd/mahad-api@.service deploy/nginx/mahad-api-multi.conf.example root@SERVER:/root/
   ```
3. **ظبط الوحدة على اللي شغال فعلًا:** قارن بـ `systemctl cat mahad-api` — `WorkingDirectory` (لازم نفس فولدر `mahad-api`)، `User`، سطور `LoadCredential` والـ secrets. نفس الفولدر، نفس الـ secrets، نفس الداتابيز.
   ```bash
   install -m 0644 /root/mahad-api@.service /etc/systemd/system/
   systemctl daemon-reload
   ```
4. **الوحدة الرئيسية تبقى «النسخة اللي فيها واتساب»:**
   ```bash
   systemctl edit mahad-api
   # واكتب:
   [Service]
   Environment=MAHAD_MULTI_INSTANCE=1
   Environment=MAHAD_INSTANCE=3001
   Environment=MAHAD_WA_WEB=1
   ```
   ```bash
   systemctl restart mahad-api
   curl -s 127.0.0.1:3001/api/health      # "status":"ok"
   ```
5. **شغّل النسخة التانية:**
   ```bash
   systemctl enable --now mahad-api@3011
   curl -s 127.0.0.1:3011/api/health      # "status":"ok"
   tail -n 20 /var/log/mahad-api-3011.log # فيه: [cache-bus] sharing cache invalidations
   ```
6. **nginx:** في ملف الموقع اللي فيه `upstream mahad_api` (و`proxy_pass http://mahad_api` للـ API)، بدّل الـ upstream باللي في `/root/mahad-api-multi.conf.example`، وزوّد الـ `upstream mahad_api_whatsapp_web` و`location ^~ /api/staff/whatsapp-web/` جوه الـ `server` قبل `location /api/`، وزوّد سطور `proxy_next_upstream` في `location /api/`.
   ```bash
   cp /etc/nginx/sites-available/<الموقع> /root/<الموقع>.before-multi
   nginx -t && systemctl reload nginx
   ```
7. **(اختياري) المهام في worker لوحده:** زي ما مكتوب في `deploy/systemd/mahad-api-worker.service`. من غيره الوحدة الرئيسية (`MAHAD_ROLE=all`) بتشغّل المهام، والنسخ الإضافية لأ.

## إزاي تتأكد

```bash
# الطلبات بتتوزع: الهيدر بيقول مين رد (3001 / 3011)
for i in 1 2 3 4 5 6; do curl -sI https://api.<الدومين>/api/health/live | grep -i x-mahad-instance; done
# حد الـ rate limit واحد للنسختين
mysql <db> -e "SELECT COUNT(*) FROM rate_limit_counters"
# مسح الكاش بيوصل للكل: احفظ سعر من الأدمن، والصف يظهر هنا
mysql <db> -e "SELECT id, channel, arg, origin, created_at FROM cache_invalidations ORDER BY id DESC LIMIT 5"
# واتساب: افتح تبويب «واتساب» كمندوب — لازم يشتغل. لو ظهر «الطلب وصل للنسخة دي بالغلط» يبقى location الواتساب في nginx ناقص.
# الإيقاف من غير انقطاع: وانت بتعمل refresh في الموقع
systemctl restart mahad-api@3011     # ولا طلب يفشل
```

الـ deploy بعد كده عادي (`deploy/release-all.sh`)، والـ log هيقول:
`rolling restart: mahad-api (:3001), then mahad-api@3011` ثم `mahad-api@3011 answers on :3011`.
لو أي نسخة مردّتش، كل حاجة بترجع للنسخة القديمة (rollback) بنفس الترتيب.

### النافذة اللي لازم تعرفها (فولدر واحد لكل النسخ)

كل النسخ شغالة من نفس الفولدر (`/var/www/mahad-api`). الـ deploy بيبني الإصدار الجديد جنبه وبيبدّل الفولدرين بـ rename. من لحظة التبديل لحد ما كل نسخة تعمل restart، النسخة القديمة لسه شغالة بالكود اللي في ذاكرتها، **لكن أي module بتعمله `require` لأول مرة (require جوه function)، وأي ملف بتقراه، بييجي من الإصدار الجديد**. ده ممكن يطلّع 500 لطلب نادر لو الـ module الجديد محتاج حاجة مش موجودة في القديم.
النافذة قصيرة على قد ما نقدر: كل نسخة بتتعمل restart أول ما اللي قبلها ترد (ثواني)، والـ health بيتسأل كل ثانية بدل `sleep 9`. لو حصل rollback، الفولدر القديم بيرجع مكانه فالنسخ اللي لسه ماتعملهاش restart بترجع سليمة. (الحل الكامل — فولدر لكل إصدار و`current` symlink — تغيير أكبر في طريقة النشر ومش معمول.)

## الإيقاف (رجوع لنسخة واحدة)

```bash
cp /root/<الموقع>.before-multi /etc/nginx/sites-available/<الموقع>   # upstream على 3001 بس
nginx -t && systemctl reload nginx
systemctl disable --now mahad-api@3011
systemctl edit mahad-api      # امسح سطور MAHAD_MULTI_INSTANCE / MAHAD_INSTANCE / MAHAD_WA_WEB
systemctl restart mahad-api
```
الجداول (`rate_limit_counters`, `cache_invalidations`, `online_presence`) بتفضل فاضية ومحدش بيكتب فيها. الـ deploy بيرجع للـ restart الواحد لوحده لأنه مش لاقي نسخ مفعّلة.

## متغيرات البيئة

| المتغير | المعنى | الافتراضي |
|---|---|---|
| `MAHAD_MULTI_INSTANCE=1` | rate limit و«مين أونلاين» في الداتابيز، ومشاركة مسح الكاش | مقفول |
| `MAHAD_INSTANCE` | اسم النسخة (البورت) في الهيدر `X-Mahad-Instance` | فاضي |
| `MAHAD_WA_WEB` | `1` النسخة دي ماسكة واتساب المندوبين، `0` أبدًا | فاضي = القفل بيقرر (زي الأول) |
| `MAHAD_ROLE` | `all` / `web` / `worker` | `all` |
| `RATE_LIMIT_STORE` | `memory` أو `mysql` (Redis بيكسب لو مفعّل) | `memory`، و`mysql` مع `MAHAD_MULTI_INSTANCE` |
| `CACHE_SYNC` / `CACHE_SYNC_MS` | إجبار مشاركة الكاش `1`/`0`، وكل قد إيه يقرا | لوحده مع worker أو نسخ / 2000 |
| `SHUTDOWN_DRAIN_MS` | مهلة الطلبات الشغالة بعد SIGTERM | 10000 (أقصى 25000) |
