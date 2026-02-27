# Contexto del chat y del proyecto

## Resumen del objetivo
Servicio Node/Express con Playwright para extraer datos desde:
- `https://crew.viper.cl/cuarteles/ahora`
- `https://crew.viper.cl/siac/resumen`
- `https://crew.viper.cl/cuarteles/todo`

Devuelve JSON y vista HTML.

## Seguridad de despliegue
- La API no tiene autenticacion/autorizacion para clientes externos (no API key/JWT).
- Debe operar en red interna y no quedar expuesta a Internet publica.
- Si se requiere acceso remoto, debe ser via capa externa de seguridad (VPN, allowlist IP o proxy con autenticacion).

## Estado actual
- Filtros por `estado` y `cuartel` en endpoints JSON/HTML.
- `estado`: match parcial (sin distinguir mayusculas/acentos).
- `cuartel`: texto parcial; si el filtro es numerico, match exacto por numero de cuartel.
- En `/report/guardia` y `/report/guardia/view`, `N° Bomberos` se calcula por estados configurables con `estado_valido` (default: `DISPONIBLE`).
- En `/report/guardia`, el campo de habilitaciones por compañía se calcula desde tags de bomberos presentes (mapeo por color), no desde tabla agregada de `/cuarteles/todo`.
- En `/report/guardia`, cada fila entrega `oficiales_detalle` (nombre/cargo/estado/es_oficial) y `oficiales_filtrados` (segun `estado_valido`) para poblar correctamente `Oficial a Cargo`.
- Habilitaciones por persona en `/report` derivadas por colores de tags de `/cuarteles/ahora` (background + color de texto) usando tabla PDF CBT.
- En `/report/siac/resumen`, una unidad con color `rgb(13, 108, 232)` se marca como `en_emergencia=true` y `disponible_operativa=true`; el reporte de guardia la cuenta como unidad en servicio.
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
- `src/habilitaciones-map.js`: catalogo de habilitaciones CBT y resolucion de tags por color.
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
