# Reporte guardias CBT

Servicio en Node/Express que abre CREW, autentica y extrae en paralelo:
- `https://crew.viper.cl/cuarteles/ahora`
- `https://crew.viper.cl/siac/resumen`
- `https://crew.viper.cl/cuarteles/todo`

Con esa captura paralela se exponen endpoints JSON/HTML.

## Variables de entorno

```bash
CREW_USERNAME=cbtemuco_central
CREW_PASSWORD=tu_password
CREW_BASE_URL=https://crew.viper.cl
HEADLESS=true
PORT=3000
SLOW_MO=0
TIMEOUT_MS=60000
PERSIST_SESSION=true
SESSION_FILE=.session/crew-storage-state.json
HOST_PORT=3005
LOG_LEVEL=info
```

Notas:
- `HEADLESS=true` para servidor Linux sin interfaz grafica.
- `PERSIST_SESSION=true` intenta reutilizar sesion entre consultas.
- `SESSION_FILE` guarda cookies/sesion de Playwright. Si la sesion expira, el servicio hace login de nuevo y sobrescribe ese archivo.
- `LOG_LEVEL` controla verbosidad (`debug`, `info`, `warn`, `error`).

## Ejecucion local (sin Docker)

```bash
npm install
npm start
```

API en `http://localhost:3000` (o el `PORT` que definas).

## Endpoints

- `GET /report` -> JSON actualizado.
- `GET /report?estado=GUARDIA%20NOCTURNA` -> estado parcial (ignora mayusculas/acentos).
- `GET /report?cuartel=Central` -> cuartel por texto parcial.
- `GET /report?cuartel=1` -> cuartel por numero exacto (no trae 10/11/12).
- `GET /report?estado=...&cuartel=...` -> ambos filtros.
- `GET /report/query?...` -> alias JSON.
- `GET /report/view` -> HTML.
- `GET /report/view/query?...` -> alias HTML.
- `GET /report/siac/resumen` -> companias, carros y resumen de personal por compañia (desde `/siac/resumen`).
- `GET /report/siac/resumen?compania=1` -> una sola compañía (match numérico exacto o texto parcial).
- `GET /report/siac/resumen/view` -> vista HTML de compañias/carros/resumen de personal.
- `GET /report/siac/resumen/view?compania=general` -> vista HTML filtrada por compañía.
- `GET /report/cuarteles/todo/habilitaciones` -> tabla `Totales por Habilitación` (desde `/cuarteles/todo`).
- `GET /report/cuarteles/todo/habilitaciones?compania=1` -> tabla de habilitaciones filtrada a una sola compañía/columna.
- `GET /report/cuarteles/todo/habilitaciones/view` -> vista HTML de la tabla `Totales por Habilitación`.
- `GET /report/cuarteles/todo/habilitaciones/view?compania=general` -> vista HTML filtrada a una sola compañía.
- `GET /report/guardia` -> reporte de guardia consolidado (JSON) para reemplazar planilla Excel.
- `GET /report/guardia?compania=1` -> reporte de guardia filtrado por una compañía.
- `GET /report/guardia?estado_valido=GUARDIA%20NOCTURNA` -> cuenta bomberos validos solo en ese estado.
- `GET /report/guardia?estado_valido=DISPONIBLE&estado_valido=GUARDIA%20NOCTURNA` -> cuenta con multiples estados validos.
- `GET /report/guardia/view` -> app web del reporte de guardia (campos editables en vista).
- `GET /health` -> health check.

### Datos de habilitaciones por persona (en `/report`)

Cada persona en `cuarteles[].personal[]` ahora incluye:
- `tags`: letras originales de CREW (compatibilidad).
- `tags_detalle`: detalle por tag con `label`, `background_color`, `text_color`, `match_type`, `habilitacion`, `candidatos`.
- `habilitaciones`: lista de nombres de habilitaciones mapeadas por color.
- `habilitaciones_detalle`: lista unica de habilitaciones resueltas (id, nombre, descripcion, colores).

El mapeo se realiza por par de color `background_color` + `text_color` segun la tabla del PDF de habilitaciones de CBT.

### Oficiales por estado (en `/report/guardia`)

Cada fila de `filas[]` ahora incluye:
- `oficiales_disponibles`: nombres presentes en el cuartel (compatibilidad).
- `oficiales_detalle`: arreglo con `{ nombre, estado, es_oficial }`.
- `oficiales_filtrados`: nombres filtrados por `estado_valido` activo.

Con esto el frontend puede poblar el combo `Oficial a Cargo` solo con opciones validas para el filtro de estado aplicado.

## Sincronizacion de datos

- Cada request a endpoints de reporte dispara una captura que consulta **en paralelo** las 3 URLs.
- Por eso, dentro de una misma respuesta, los datasets provienen de la misma corrida temporal (`captured_at` de esa corrida).

## Mapeo Excel -> API (reporte de guardia)

- `Cantidad total de bomberos de guardia`: suma de `n_bomberos` por compañía.
- `Cantidad total de compañías y brigadas en servicio`: compañías con estado `0-9`.
- `Cantidad total de conductores en servicio`: suma de conductores detectados por compañía en unidades en servicio.
- `Estado (0-8 / 0-9)`: `0-9` si tiene al menos una unidad en servicio (disponible + conductor) y bomberos presentes; si no, `0-8`.
- `Oficial a cargo`: en la app web es un desplegable con todos los presentes de ese cuartel/compañía.
- `N° Bomberos`: total del cuartel segun estados validos configurados en `estado_valido` (por defecto: `DISPONIBLE`).
- `Habilitaciones`: desglose por compañía segun bomberos presentes con estado valido (ej: `4 Asistente de Trauma / 2 Inicial`), calculado desde tags mapeados por color en `/report`.
- `Conductores`: listado de conductores por unidades en servicio (desde `/report/siac/resumen`).
- `Desglose unidades`: conteo por tipo (`B,BX,Q,M,QM,GR,H,BH,BR,RX,K,S,Z,MX`) usando unidades en servicio.

Nota:
- En la vista `/report/guardia/view`, los campos `Oficial a Cargo` y `Observaciones` se guardan en `localStorage` del navegador.
- En la vista `/report/guardia/view` hay un selector de estados validos dentro del cuadro de metricas para recalcular el reporte.

## Docker Compose (Coolify / Debian)

El repo incluye:
- `Dockerfile` (base Playwright, listo para Chromium headless).
- `docker-compose.yml` (expone puerto y crea volumen para sesion persistente).

### Levantar en local con Docker Compose

```bash
docker compose up -d --build
```

Queda disponible en:
- `http://localhost:${HOST_PORT:-3005}`

### Ver logs del servicio

```bash
docker compose logs -f reporte-guardias
```

Eventos relevantes que ahora se registran:
- `http_request_start` / `http_request_end` / `http_request_error`
- `scrape_lock_acquired` / `scrape_lock_reused` / `scrape_lock_released`
- `crew_parallel_fetch_start`
- `crew_navigation_start`
- `crew_session_check`, `crew_session_reused`
- `crew_login_start`, `crew_login_success`
- `crew_session_saved`
- `scrape_success` / `scrape_error`

### Despliegue en Coolify

1. Crear servicio tipo **Docker Compose** apuntando a este repo.
2. Configurar variables de entorno (al menos `CREW_USERNAME`, `CREW_PASSWORD`).
3. Mantener `HEADLESS=true`.
4. Mantener el volumen montado en `/app/.session` para persistir la sesion.

## Comportamiento de sesion

En cada consulta:
1. Si existe `SESSION_FILE`, Playwright lo carga.
2. Si CREW ya reconoce la sesion, no hace login.
3. Si aparece formulario de login (sesion expirada/invalida), hace login y guarda nueva sesion.

## Ejecutar una sola vez

```bash
npm run report
```

Salida: JSON por stdout.
