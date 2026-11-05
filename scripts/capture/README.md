# Scripts de capturas

Herramientas de desarrollo para generar capturas de pantalla con Playwright.
No forman parte de la app ni del despliegue. Algunos inician sesión con
`docente@universidad.edu`: desde PT-03 esa cuenta solo existe si se crea con
`SEED_HOST_EMAIL` y `SEED_HOST_PASSWORD` al correr el seed.

Los scripts operativos `backup-db.sh` y `restore-db.sh` siguen en `scripts/`; el worker está en `backend/worker.js`.

Antes de capturar, levanta la app desde la raíz del repositorio con `npm run dev`
(corre el workspace `frontend/`) y, si hace falta la cuenta de anfitrión, crea los
datos con `npm run prisma:seed`.
