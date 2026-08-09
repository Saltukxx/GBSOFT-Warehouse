# GBSoft Optimizer

FastAPI üzerinde çalışan deterministik OR-Tools CP-SAT SKU→lokasyon servisidir.
Kapasite, ekipman, zon, blokaj, kilit, freeze/fixed-slot, move budget ve tek
SKU/göz kurallarını hard constraint olarak uygular.

## Yerel geliştirme

```bash
python3 -m venv services/optimizer/.venv
services/optimizer/.venv/bin/pip install -e 'services/optimizer[dev]'
npm run dev:optimizer
```

API `http://127.0.0.1:8001`, sağlık kontrolü `/health`, çözüm ucu `/solve`.

```bash
npm run test:optimizer
```

## Docker

Kök dizinden `npm run services:up` PostgreSQL ve optimizer'ı birlikte açar.
Fastify API host üzerinde kalır ve `.env` içindeki `OPTIMIZER_URL` ile bağlanır.

## Sonuç dürüstlüğü

- Aynı snapshot + seed aynı sonucu verir; tek worker kullanılır.
- Zaman sınırında çözüm bulunmuşsa kalite `feasible`, bulunmamışsa `timeout` olur.
- `optimal` yalnız CP-SAT bunu kanıtladığında iç kalite alanına yazılır.
- Uygulanamaz modeller assumption core ve denenebilir gevşetmeleri döndürür.
