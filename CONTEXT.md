# Contexto del chat y del proyecto

## Resumen del objetivo
Servicio Node/Express con Playwright para extraer datos desde:
- `https://crew.viper.cl/cuarteles/ahora`
- `https://crew.viper.cl/siac/resumen`
- `https://crew.viper.cl/cuarteles/todo`

Devuelve JSON y vista HTML.

## Estado actual
- Filtros por `estado` y `cuartel` en endpoints JSON/HTML.
- `estado`: match parcial (sin distinguir mayusculas/acentos).
- `cuartel`: texto parcial; si el filtro es numerico, match exacto por numero de cuartel.
- En `/report/guardia` y `/report/guardia/view`, `N° Bomberos` se calcula por estados configurables con `estado_valido` (default: `DISPONIBLE`).
- JSON/HTML sin imagenes (`foto_url` eliminado y sin `<img>` en vista).
- Logging estructurado JSON a stdout/stderr para `docker logs` (requests, lock de scrape, navegacion a CREW, login/sesion y errores).
- Scraping paralelo por request para las 3 URLs (ahora + siac/resumen + cuarteles/todo) para mantener consistencia temporal por corrida.

## Persistencia de sesion
Implementada en `src/scrape.js`:
- Variables nuevas: `PERSIST_SESSION`, `SESSION_FILE`.
- Si existe `SESSION_FILE`, se carga `storageState` antes de navegar.
- Si la sesion sigue activa, no se hace login.
- Si aparece login, se autentica con `CREW_USERNAME`/`CREW_PASSWORD` y se guarda de nuevo el `SESSION_FILE`.

## Docker / Coolify
Archivos agregados:
- `Dockerfile`: imagen Playwright headless para Linux sin UI.
- `docker-compose.yml`: servicio con puerto configurable y volumen persistente de sesion.
- `.dockerignore`: reduce contexto de build.

Volumen de sesion en compose:
- `/app/.session` (persistente) para mantener `crew-storage-state.json`.

## Estructura principal
- `src/scrape.js`: login, reutilizacion de sesion y extraccion paralela de las 3 fuentes.
- `src/server.js`: API Express, filtros y endpoints.
- `src/guardia-report.js`: logica de mapeo para reporte de guardias (modelo excel -> datos API).
- `src/logger.js`: logging estructurado JSON (stdout/stderr) para Docker.
- `src/run-once.js`: ejecucion unica por stdout.
- `Dockerfile`: contenedor de produccion.
- `docker-compose.yml`: orquestacion local/coolify.

## Endpoints
- `GET /report`
- `GET /report/query`
- `GET /report/view`
- `GET /report/view/query`
- `GET /report/siac/resumen`
- `GET /report/siac/resumen/view`
- `GET /report/cuarteles/todo/habilitaciones`
- `GET /report/cuarteles/todo/habilitaciones/view`
- `GET /report/guardia`
- `GET /report/guardia/view`
- `GET /health`

Soportan query params:
- `estado`
- `cuartel`
- `compania` (`cia` como alias, para endpoints SIAC/Habilitaciones)
- `estado_valido` (`estados_validos`/`estado_bombero` como alias, para `/report/guardia` y `/report/guardia/view`)
- `show` / `headless` / `slowmo` / `timeout`

## Variables de entorno
- `CREW_USERNAME`
- `CREW_PASSWORD`
- `CREW_BASE_URL` (default: `https://crew.viper.cl`)
- `HEADLESS` (default recomendado: `true` en servidor)
- `PORT` (default: 3000)
- `SLOW_MO` (opcional)
- `TIMEOUT_MS` (opcional)
- `PERSIST_SESSION` (default: `true`)
- `SESSION_FILE` (default: `.session/crew-storage-state.json`)
- `HOST_PORT` (solo compose, host externo)
- `LOG_LEVEL` (`debug` | `info` | `warn` | `error`, default: `info`)
