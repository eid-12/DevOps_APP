# CloudBase

منصة نشر سحابية على Mini PC (Windows + WSL2 + Docker)، بواجهة Angular وباكند Spring Boot.

## هيكل المشروع

```
DevOps_APP/
├── README.md          # هذا الملف
├── docs/              # الوثائق العامة
├── frontend/          # Angular
└── backend/           # Spring Boot
```

## التشغيل

حالياً نركز على الفرونت فقط. الواجهة تعمل ببيانات وهمية محلية (بدون باكند).

### الفرونت

```bash
cd frontend
npm install
npm start
```

الواجهة: `http://localhost:4200`

### الباكند (لاحقاً)

```bash
cd backend
./mvnw spring-boot:run
```

## حسابات تجريبية

| الدور | البريد | كلمة المرور |
|--------|--------|-------------|
| Admin | `admin@cloudbase.dev` | `Admin@2026` |
| User | `dev@cloudbase.dev` | `Dev@2026` |

## ما يعمل الآن

- تسجيل دخول / تسجيل حساب
- إنشاء مشروع (انتظار موافقة)
- لوحة المطور: عرض / تشغيل / إيقاف
- لوحة الأدمن: موافقة، صلاحيات النشر، مراقبة البنية

## الخطوات القادمة

- PostgreSQL + JWT
- GitHub OAuth
- Portainer API
- Nginx Proxy Manager API
- WebSockets + Terminal
