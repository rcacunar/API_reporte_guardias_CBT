require('dotenv').config();

const { randomUUID } = require('crypto');
const express = require('express');
const { scrapeCrewSnapshot, getRuntimeConfig } = require('./scrape');
const { writeLog } = require('./logger');
const { buildGuardiaReport } = require('./guardia-report');

const app = express();
const port = process.env.PORT || 3000;

let currentSnapshotRun = null;
let currentSnapshotOwnerTraceId = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseQueryText(value) {
  if (value === undefined || value === null) return null;
  const parsed = String(value).trim();
  return parsed || null;
}

function parseQueryList(value) {
  if (value === undefined || value === null) return [];

  const rawItems = Array.isArray(value) ? value : [value];
  return rawItems
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveTraceId(req) {
  const incoming = req.headers['x-trace-id'];
  if (typeof incoming === 'string' && incoming.trim()) return incoming.trim();
  if (Array.isArray(incoming) && incoming.length > 0) {
    const firstValid = incoming.find((value) => typeof value === 'string' && value.trim());
    if (firstValid) return firstValid.trim();
  }
  return randomUUID();
}

function resolveHeadlessOverride(query, envDefault) {
  if (query.show === '1' || query.show === 'true') return false;
  if (query.headless === '1' || query.headless === 'true') return true;
  if (query.headless === '0' || query.headless === 'false') return false;
  return envDefault;
}

async function runSnapshotWithLock(config, traceId) {
  if (!currentSnapshotRun) {
    currentSnapshotOwnerTraceId = traceId || null;
    writeLog('info', 'scrape_lock_acquired', {
      traceId,
      ownerTraceId: currentSnapshotOwnerTraceId
    });

    currentSnapshotRun = scrapeCrewSnapshot(config).finally(() => {
      writeLog('info', 'scrape_lock_released', {
        traceId: currentSnapshotOwnerTraceId,
        ownerTraceId: currentSnapshotOwnerTraceId
      });
      currentSnapshotRun = null;
      currentSnapshotOwnerTraceId = null;
    });
  } else {
    writeLog('info', 'scrape_lock_reused', {
      traceId,
      ownerTraceId: currentSnapshotOwnerTraceId
    });
  }

  return currentSnapshotRun;
}

async function getSnapshotData(req, traceId) {
  const runtime = getRuntimeConfig();
  const headless = resolveHeadlessOverride(req.query, runtime.headless);
  const slowMo = req.query.slowmo ? Number(req.query.slowmo) : runtime.slowMo;
  const timeoutMs = req.query.timeout ? Number(req.query.timeout) : runtime.timeoutMs;

  writeLog('debug', 'snapshot_runtime_resolved', {
    traceId,
    headless,
    slowMo,
    timeoutMs
  });

  return runSnapshotWithLock({
    ...runtime,
    headless,
    slowMo,
    timeoutMs,
    traceId
  }, traceId);
}

function buildNowReport(snapshot) {
  return {
    captured_at: snapshot?.captured_at,
    source_url: snapshot?.source_urls?.cuarteles_ahora || '',
    cuarteles: Array.isArray(snapshot?.cuarteles_ahora) ? snapshot.cuarteles_ahora : []
  };
}

function extractFilters(query) {
  return {
    estado: parseQueryText(query.estado),
    cuartel: parseQueryText(query.cuartel)
  };
}

function matchesNumericOrTextFilter(targetName, normalizedFilter) {
  const normalizedTarget = normalizeText(targetName);

  if (/^\d+$/.test(normalizedFilter)) {
    const targetNumbers = normalizedTarget.match(/\d+/g) || [];
    return targetNumbers.includes(normalizedFilter);
  }

  return normalizedTarget.includes(normalizedFilter);
}

function matchesCuartelFilter(cuartelName, cuartelFilter) {
  return matchesNumericOrTextFilter(cuartelName, cuartelFilter);
}

function extractCompaniaFilter(query) {
  return parseQueryText(query.compania ?? query.cia);
}

function extractEstadoValidoFilters(query) {
  return parseQueryList(query.estado_valido ?? query.estados_validos ?? query.estado_bombero);
}

function applyNowReportFilters(report, filters) {
  const hasEstadoFilter = Boolean(filters.estado);
  const hasCuartelFilter = Boolean(filters.cuartel);

  if (!hasEstadoFilter && !hasCuartelFilter) {
    return report;
  }

  const estadoFilter = normalizeText(filters.estado);
  const cuartelFilter = normalizeText(filters.cuartel);
  const cuarteles = Array.isArray(report?.cuarteles) ? report.cuarteles : [];

  const filteredCuarteles = cuarteles
    .filter((cuartel) => {
      if (!hasCuartelFilter) return true;
      return matchesCuartelFilter(cuartel.cuartel, cuartelFilter);
    })
    .map((cuartel) => {
      const personal = Array.isArray(cuartel.personal) ? cuartel.personal : [];
      const filteredPersonal = hasEstadoFilter
        ? personal.filter((persona) => normalizeText(persona.estado).includes(estadoFilter))
        : personal;

      return {
        ...cuartel,
        total_personal: filteredPersonal.length,
        personal: filteredPersonal
      };
    })
    .filter((cuartel) => !hasEstadoFilter || cuartel.personal.length > 0);

  return {
    ...report,
    cuarteles: filteredCuarteles,
    filtros_aplicados: {
      estado: filters.estado,
      cuartel: filters.cuartel
    }
  };
}

async function getNowReportData(req, traceId) {
  const snapshot = await getSnapshotData(req, traceId);
  const report = buildNowReport(snapshot);
  const filters = extractFilters(req.query);
  const filtered = applyNowReportFilters(report, filters);

  writeLog('info', 'report_filters_applied', {
    traceId,
    estado: filters.estado,
    cuartel: filters.cuartel,
    cuartelesCount: Array.isArray(filtered?.cuarteles) ? filtered.cuarteles.length : 0
  });

  return filtered;
}

async function getSiacResumenData(req, traceId) {
  const snapshot = await getSnapshotData(req, traceId);
  const companiaFilterRaw = extractCompaniaFilter(req.query);
  const companiaFilter = normalizeText(companiaFilterRaw);

  const baseData = {
    captured_at: snapshot?.captured_at,
    source_url: snapshot?.source_urls?.siac_resumen || '',
    ...(snapshot?.siac_resumen || { companias: [], total_companias: 0, total_carros: 0 })
  };

  if (!companiaFilterRaw) return baseData;

  const companias = Array.isArray(baseData?.companias) ? baseData.companias : [];
  const filteredCompanias = companias.filter((item) =>
    matchesNumericOrTextFilter(item?.compania || '', companiaFilter)
  );
  const totalCarros = filteredCompanias.reduce((sum, item) => sum + (item?.carros?.length || 0), 0);

  const result = {
    ...baseData,
    companias: filteredCompanias,
    total_companias: filteredCompanias.length,
    total_carros: totalCarros,
    filtros_aplicados: {
      compania: companiaFilterRaw
    }
  };

  if (filteredCompanias.length === 0) {
    result.warning = 'compania_not_found';
  }

  writeLog('info', 'siac_filters_applied', {
    traceId,
    compania: companiaFilterRaw,
    companiasCount: filteredCompanias.length
  });

  return result;
}

async function getHabilitacionesData(req, traceId) {
  const snapshot = await getSnapshotData(req, traceId);
  const companiaFilterRaw = extractCompaniaFilter(req.query);
  const companiaFilter = normalizeText(companiaFilterRaw);

  const baseData = {
    captured_at: snapshot?.captured_at,
    source_url: snapshot?.source_urls?.cuarteles_todo || '',
    ...(snapshot?.cuarteles_todo_habilitaciones || { titulo: 'Totales por Habilitación', columnas: [], filas: [] })
  };

  if (!companiaFilterRaw) return baseData;

  const columnas = Array.isArray(baseData?.columnas) ? baseData.columnas : [];
  const columnaHabilitacion = columnas[0] || 'Cuartel';
  const columnasCompanias = columnas.slice(1);

  const columnaSeleccionada =
    columnasCompanias.find((col) => matchesNumericOrTextFilter(col, companiaFilter)) || null;

  if (!columnaSeleccionada) {
    writeLog('info', 'habilitaciones_filters_applied', {
      traceId,
      compania: companiaFilterRaw,
      matchedColumn: null,
      filasCount: 0
    });

    return {
      ...baseData,
      columnas: [columnaHabilitacion],
      filas: [],
      filtros_aplicados: {
        compania: companiaFilterRaw
      },
      warning: 'compania_not_found'
    };
  }

  const filas = Array.isArray(baseData?.filas) ? baseData.filas : [];
  const filteredFilas = filas.map((fila) => ({
    habilitacion: fila?.habilitacion || null,
    valores: {
      [columnaSeleccionada]: fila?.valores?.[columnaSeleccionada] ?? null
    }
  }));

  writeLog('info', 'habilitaciones_filters_applied', {
    traceId,
    compania: companiaFilterRaw,
    matchedColumn: columnaSeleccionada,
    filasCount: filteredFilas.length
  });

  return {
    ...baseData,
    columnas: [columnaHabilitacion, columnaSeleccionada],
    filas: filteredFilas,
    filtros_aplicados: {
      compania: companiaFilterRaw
    }
  };
}

async function getGuardiaReportData(req, traceId) {
  const snapshot = await getSnapshotData(req, traceId);
  const companiaFilterRaw = extractCompaniaFilter(req.query);
  const estadosValidos = extractEstadoValidoFilters(req.query);
  const report = buildGuardiaReport(snapshot, {
    compania: companiaFilterRaw,
    estadosValidos
  });

  writeLog('info', 'guardia_report_generated', {
    traceId,
    compania: companiaFilterRaw || null,
    estadosValidos: report?.filtros_aplicados?.estados_validos || [],
    filasCount: Array.isArray(report?.filas) ? report.filas.length : 0,
    totalBomberos: report?.metricas?.total_bomberos_guardia ?? 0
  });

  return report;
}

function renderReportHtml(report) {
  const captured = report?.captured_at ? new Date(report.captured_at).toLocaleString() : 'N/A';
  const errorNotice = report?.error
    ? `<div class="error">Error: ${escapeHtml(report.error)}</div>`
    : '';

  const cuarteles = Array.isArray(report?.cuarteles) ? report.cuarteles : [];
  const filtros = report?.filtros_aplicados || {};
  const filtrosActivos = [];
  if (filtros.estado) filtrosActivos.push(`Estado: ${filtros.estado}`);
  if (filtros.cuartel) filtrosActivos.push(`Cuartel: ${filtros.cuartel}`);

  const rowsHtml = cuarteles
    .map((cuartel) => {
      const personalRows = (cuartel.personal || [])
        .map((persona) => {
          const tags = Array.isArray(persona.tags) ? persona.tags.join(' ') : '';
          const habilitaciones = Array.isArray(persona.habilitaciones) ? persona.habilitaciones.join(' | ') : '';

          return `
            <tr>
              <td>${escapeHtml(persona.registro || '')}</td>
              <td>${escapeHtml(persona.cargo || '')}</td>
              <td>${escapeHtml(persona.estado || '')}</td>
              <td>${escapeHtml(persona.nombre || '')}</td>
              <td>${escapeHtml(tags)}</td>
              <td>${escapeHtml(habilitaciones)}</td>
            </tr>
          `;
        })
        .join('');

      const personalTable = `
        <table class="inner">
          <thead>
            <tr>
              <th>Registro</th>
              <th>Cargo</th>
              <th>Estado</th>
              <th>Nombre</th>
              <th>Tags</th>
              <th>Habilitaciones</th>
            </tr>
          </thead>
          <tbody>
            ${personalRows || '<tr><td colspan="6" class="muted">Sin personal</td></tr>'}
          </tbody>
        </table>
      `;

      return `
        <tr>
          <td class="cuartel">${escapeHtml(cuartel.cuartel || '')}</td>
          <td class="center">${escapeHtml(cuartel.disponibles ?? '')}</td>
          <td class="center">${escapeHtml(cuartel.total_personal ?? '')}</td>
          <td>${personalTable}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Reporte guardias CBT</title>
        <style>
          :root {
            color-scheme: light;
            font-family: "Source Sans Pro", "Segoe UI", Arial, sans-serif;
            background: #f6f7fb;
            color: #1b1f24;
          }
          body { margin: 0; padding: 24px; }
          header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
          h1 { margin: 0; font-size: 24px; }
          .meta { color: #4a5568; font-size: 14px; }
          .error { background: #ffe3e3; color: #7a0b0b; padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; }
          table { width: 100%; border-collapse: collapse; background: #fff; }
          th, td { border: 1px solid #e2e8f0; padding: 8px; vertical-align: top; font-size: 13px; }
          th { background: #edf2f7; text-align: left; }
          .center { text-align: center; }
          .cuartel { font-weight: 600; }
          .muted { color: #718096; }
          .inner { margin-top: 6px; }
          .inner th { background: #f7fafc; font-size: 12px; }
          .inner td { font-size: 12px; }
          @media (max-width: 900px) {
            body { padding: 12px; }
            th, td { font-size: 12px; }
            .inner th, .inner td { font-size: 11px; }
          }
        </style>
      </head>
      <body>
        <header>
          <h1>Reporte guardias CBT</h1>
          <div class="meta">Actualizado: ${escapeHtml(captured)}</div>
          <div class="meta">Fuente: ${escapeHtml(report?.source_url || '')}</div>
          ${filtrosActivos.length ? `<div class="meta">Filtros: ${escapeHtml(filtrosActivos.join(' | '))}</div>` : ''}
        </header>
        ${errorNotice}
        <table>
          <thead>
            <tr>
              <th>Cuartel</th>
              <th>Disponibles</th>
              <th>Total personal</th>
              <th>Personal</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || '<tr><td colspan="4" class="muted">Sin datos</td></tr>'}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

function renderPageShell({ title, capturedAt, sourceUrl, bodyHtml, error }) {
  const captured = capturedAt ? new Date(capturedAt).toLocaleString() : 'N/A';
  const errorNotice = error
    ? `<div class="error">Error: ${escapeHtml(error)}</div>`
    : '';

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
        <style>
          :root {
            color-scheme: light;
            font-family: "Source Sans Pro", "Segoe UI", Arial, sans-serif;
            background: #f6f7fb;
            color: #1b1f24;
          }
          body { margin: 0; padding: 24px; }
          header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
          h1 { margin: 0; font-size: 24px; }
          .meta { color: #4a5568; font-size: 14px; }
          .error { background: #ffe3e3; color: #7a0b0b; padding: 10px 12px; border-radius: 8px; margin-bottom: 12px; }
          .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px; margin-bottom: 12px; }
          table { width: 100%; border-collapse: collapse; background: #fff; }
          th, td { border: 1px solid #e2e8f0; padding: 8px; vertical-align: top; font-size: 13px; }
          th { background: #edf2f7; text-align: left; }
          .muted { color: #718096; }
          .center { text-align: center; }
          .inner th { background: #f7fafc; font-size: 12px; }
          .inner td { font-size: 12px; }
          @media (max-width: 900px) {
            body { padding: 12px; }
            th, td { font-size: 12px; }
            .inner th, .inner td { font-size: 11px; }
          }
        </style>
      </head>
      <body>
        <header>
          <h1>${escapeHtml(title)}</h1>
          <div class="meta">Actualizado: ${escapeHtml(captured)}</div>
          <div class="meta">Fuente: ${escapeHtml(sourceUrl || '')}</div>
        </header>
        ${errorNotice}
        ${bodyHtml}
      </body>
    </html>
  `;
}

function renderSiacResumenHtml(data) {
  const companias = Array.isArray(data?.companias) ? data.companias : [];
  const filtroCompania = data?.filtros_aplicados?.compania || null;
  const warningHtml =
    data?.warning === 'compania_not_found'
      ? '<div class="card muted">No se encontraron compañías para el filtro indicado.</div>'
      : '';
  const cardsHtml = companias
    .map((compania) => {
      const carros = Array.isArray(compania?.carros) ? compania.carros : [];
      const carrosRows = carros
        .map((carro) => {
          return `
            <tr>
              <td>${escapeHtml(carro?.carro || '')}</td>
              <td>${escapeHtml(carro?.estado || '')}</td>
              <td>${escapeHtml(carro?.conductor || '')}</td>
              <td>${escapeHtml(carro?.disponible || '')}</td>
              <td>${escapeHtml(carro?.mecanica || '')}</td>
            </tr>
          `;
        })
        .join('');

      return `
        <div class="card">
          <div><strong>${escapeHtml(compania?.compania || '')}</strong></div>
          <div class="meta">Disponibles: ${escapeHtml(compania?.personal_resumen?.disponibles ?? '')} | Total: ${escapeHtml(compania?.personal_resumen?.total ?? '')}</div>
          <table class="inner" style="margin-top:10px;">
            <thead>
              <tr>
                <th>Carro</th>
                <th>Estado</th>
                <th>Conductor</th>
                <th>Disponible</th>
                <th>Mecánica</th>
              </tr>
            </thead>
            <tbody>
              ${carrosRows || '<tr><td colspan="5" class="muted">Sin carros</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    })
    .join('');

  const bodyHtml = `
    <div class="card">
      <div><strong>Compañías:</strong> ${escapeHtml(data?.total_companias ?? 0)}</div>
      <div><strong>Total carros:</strong> ${escapeHtml(data?.total_carros ?? 0)}</div>
      ${filtroCompania ? `<div><strong>Filtro compañía:</strong> ${escapeHtml(filtroCompania)}</div>` : ''}
    </div>
    ${warningHtml}
    ${cardsHtml || '<div class="card muted">Sin datos</div>'}
  `;

  return renderPageShell({
    title: 'Resumen Operacional SIAC',
    capturedAt: data?.captured_at,
    sourceUrl: data?.source_url,
    bodyHtml,
    error: data?.error
  });
}

function renderHabilitacionesHtml(data) {
  const columnas = Array.isArray(data?.columnas) ? data.columnas : [];
  const columnasDetalle = columnas.slice(1);
  const filas = Array.isArray(data?.filas) ? data.filas : [];
  const filtroCompania = data?.filtros_aplicados?.compania || null;
  const warningHtml =
    data?.warning === 'compania_not_found'
      ? '<div class="card muted">No se encontró la compañía solicitada en la tabla.</div>'
      : '';

  const headColsHtml = columnasDetalle.map((col) => `<th>${escapeHtml(col)}</th>`).join('');
  const rowsHtml = filas
    .map((fila) => {
      const valuesHtml = columnasDetalle
        .map((col) => {
          const value = fila?.valores?.[col];
          return `<td class="center">${escapeHtml(value ?? '')}</td>`;
        })
        .join('');

      return `
        <tr>
          <td>${escapeHtml(fila?.habilitacion || '')}</td>
          ${valuesHtml}
        </tr>
      `;
    })
    .join('');

  const bodyHtml = `
    <div class="card">
      <div><strong>Tabla:</strong> ${escapeHtml(data?.titulo || 'Totales por Habilitación')}</div>
      <div><strong>Filas:</strong> ${escapeHtml(filas.length)}</div>
      ${filtroCompania ? `<div><strong>Filtro compañía:</strong> ${escapeHtml(filtroCompania)}</div>` : ''}
    </div>
    ${warningHtml}
    <table>
      <thead>
        <tr>
          <th>Habilitación</th>
          ${headColsHtml}
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="${Math.max(1, columnasDetalle.length + 1)}" class="muted">Sin datos</td></tr>`}
      </tbody>
    </table>
  `;

  return renderPageShell({
    title: 'Totales por Habilitación',
    capturedAt: data?.captured_at,
    sourceUrl: data?.source_url,
    bodyHtml,
    error: data?.error
  });
}

function renderGuardiaReportHtml(data) {
  const rows = Array.isArray(data?.filas) ? data.filas : [];
  const unitTypes = Array.isArray(data?.tipos_unidades) ? data.tipos_unidades : [];
  const filtros = data?.filtros_aplicados || {};
  const estadosDisponibles = Array.isArray(data?.estados_disponibles) ? data.estados_disponibles : [];
  const estadosValidos = Array.isArray(filtros?.estados_validos) ? filtros.estados_validos : [];
  const resumenUnidades = data?.metricas?.resumen_unidades_servicio || {};
  const estadosSelector = [...estadosDisponibles];
  for (const selectedEstado of estadosValidos) {
    const exists = estadosSelector.some((estado) => normalizeText(estado) === normalizeText(selectedEstado));
    if (!exists) estadosSelector.push(selectedEstado);
  }
  const estadoOptions = estadosSelector
    .map((estado) => {
      const selected = estadosValidos.some((selectedValue) => normalizeText(selectedValue) === normalizeText(estado));
      return `<option value="${escapeHtml(estado)}"${selected ? ' selected' : ''}>${escapeHtml(estado)}</option>`;
    })
    .join('');
  const filtroCompaniaHidden = filtros?.compania
    ? `<input type="hidden" name="compania" value="${escapeHtml(filtros.compania)}" />`
    : '';

  const metricasHtml = `
    <div class="card">
      <div><strong>Cantidad total de bomberos de guardia:</strong> ${escapeHtml(data?.metricas?.total_bomberos_guardia ?? 0)}</div>
      <div><strong>Cantidad total de compañías y brigadas en servicio:</strong> ${escapeHtml(data?.metricas?.total_companias_servicio ?? 0)}</div>
      <div><strong>Cantidad total de conductores en servicio:</strong> ${escapeHtml(data?.metricas?.total_conductores_servicio ?? 0)}</div>
      ${filtros?.compania ? `<div><strong>Filtro compañía:</strong> ${escapeHtml(filtros.compania)}</div>` : ''}
      <div><strong>Estados válidos para N° Bomberos:</strong> ${escapeHtml(estadosValidos.join(', ') || 'DISPONIBLE')}</div>
      <form method="get" action="/report/guardia/view" style="margin-top:10px; display:flex; flex-direction:column; gap:8px; max-width:420px;">
        ${filtroCompaniaHidden}
        <label for="estado-valido-select"><strong>Seleccionar estados válidos</strong></label>
        <select id="estado-valido-select" name="estado_valido" multiple size="${Math.max(3, Math.min(8, estadosSelector.length || 3))}" style="width:100%;">
          ${estadoOptions}
        </select>
        <div class="meta">Usa Ctrl/Cmd + clic para seleccionar más de un estado.</div>
        <button type="submit" style="width:max-content; padding:6px 10px; border:1px solid #cbd5e0; border-radius:6px; background:#fff; cursor:pointer;">Aplicar estados</button>
      </form>
    </div>
  `;

  const resumenUnidadesHead = unitTypes.map((type) => `<th>${escapeHtml(type)}</th>`).join('');
  const resumenUnidadesCells = unitTypes
    .map((type) => `<td class="center">${escapeHtml(resumenUnidades[type] ?? 0)}</td>`)
    .join('');
  const resumenUnidadesHtml = `
    <div class="card">
      <div style="margin-bottom:8px;"><strong>Resumen total de unidades en servicio</strong></div>
      <table>
        <thead>
          <tr>${resumenUnidadesHead}</tr>
        </thead>
        <tbody>
          <tr>${resumenUnidadesCells}</tr>
        </tbody>
      </table>
    </div>
  `;

  const tableHeadUnits = unitTypes.map((type) => `<th>${escapeHtml(type)}</th>`).join('');
  const rowsHtml = rows
    .map((row, index) => {
      const companiaKey = row?.compania_key || `row_${index}`;
      const oficiales = Array.isArray(row?.oficiales_disponibles) ? row.oficiales_disponibles : [];
      const oficialesOptions = oficiales
        .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`)
        .join('');

      const conductores = Array.isArray(row?.conductores) ? row.conductores : [];
      const c1 = conductores[0] || '';
      const c2 = conductores[1] || '';
      const c3 = conductores[2] || '';
      const resumenHabilitaciones = Array.isArray(row?.resumen_habilitaciones)
        ? row.resumen_habilitaciones.join(' / ')
        : row?.resumen_habilitaciones_texto || '';
      const unitsCells = unitTypes
        .map((type) => `<td class="center">${escapeHtml(row?.unidades?.[type] ?? 0)}</td>`)
        .join('');

      return `
        <tr data-compania-key="${escapeHtml(companiaKey)}">
          <td>${escapeHtml(row?.compania || '')}</td>
          <td class="center">${escapeHtml(row?.estado || '')}</td>
          <td>
            <select data-field="oficial" style="width:100%;">
              <option value="">Seleccionar</option>
              ${oficialesOptions}
            </select>
          </td>
          <td class="center">${escapeHtml(row?.n_bomberos ?? 0)}</td>
          <td>${escapeHtml(resumenHabilitaciones)}</td>
          <td>${escapeHtml(c1)}</td>
          <td>${escapeHtml(c2)}</td>
          <td>${escapeHtml(c3)}</td>
          <td><textarea data-field="comentarios" rows="2" style="width:100%;"></textarea></td>
          ${unitsCells}
        </tr>
      `;
    })
    .join('');

  const bodyHtml = `
    ${metricasHtml}
    ${resumenUnidadesHtml}
    <table>
      <thead>
        <tr>
          <th>Compañías</th>
          <th>Estado</th>
          <th>Oficial a Cargo</th>
          <th>N° Bomberos</th>
          <th>Habilitaciones</th>
          <th>Conductor 1</th>
          <th>Conductor 2</th>
          <th>Conductor 3</th>
          <th>Observaciones</th>
          ${tableHeadUnits}
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="${9 + unitTypes.length}" class="muted">Sin datos</td></tr>`}
      </tbody>
    </table>
    <script>
      (function () {
        const STORAGE_KEY = 'guardia_report_inputs_v1';
        let state = {};
        try {
          state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') || {};
        } catch (error) {
          state = {};
        }

        function saveState() {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        }

        document.querySelectorAll('tr[data-compania-key]').forEach((row) => {
          const key = row.getAttribute('data-compania-key');
          if (!key) return;

          const oficialSelect = row.querySelector('select[data-field=\"oficial\"]');
          const comentariosInput = row.querySelector('textarea[data-field=\"comentarios\"]');
          const current = state[key] || {};

          if (oficialSelect && current.oficial) oficialSelect.value = current.oficial;
          if (comentariosInput && current.comentarios) comentariosInput.value = current.comentarios;

          if (oficialSelect) {
            oficialSelect.addEventListener('change', () => {
              state[key] = state[key] || {};
              state[key].oficial = oficialSelect.value || '';
              saveState();
            });
          }

          if (comentariosInput) {
            comentariosInput.addEventListener('input', () => {
              state[key] = state[key] || {};
              state[key].comentarios = comentariosInput.value || '';
              saveState();
            });
          }
        });
      })();
    </script>
  `;

  return renderPageShell({
    title: 'Reporte de Guardias',
    capturedAt: data?.captured_at,
    sourceUrl: data?.source_urls?.cuarteles_ahora || '',
    bodyHtml,
    error: data?.error
  });
}

function startRequestLog(req, res) {
  const traceId = resolveTraceId(req);
  const startedAt = Date.now();

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Trace-Id', traceId);

  writeLog('info', 'http_request_start', {
    traceId,
    method: req.method,
    path: req.path,
    query: req.query
  });

  return { traceId, startedAt };
}

function endRequestLog({ traceId, startedAt, req, statusCode, error }) {
  const event = error ? 'http_request_error' : 'http_request_end';
  const level = error ? 'error' : 'info';

  writeLog(level, event, {
    traceId,
    method: req.method,
    path: req.path,
    statusCode,
    durationMs: Date.now() - startedAt,
    error: error ? error.message || String(error) : undefined
  });
}

async function handleJsonReport(req, res) {
  const logCtx = startRequestLog(req, res);

  try {
    const data = await getNowReportData(req, logCtx.traceId);
    res.json(data);
    endRequestLog({ ...logCtx, req, statusCode: 200 });
  } catch (error) {
    res.status(500).json({
      error: error.message || 'Unexpected error',
      hint: 'Check CREW_USERNAME/CREW_PASSWORD and network connectivity.'
    });
    endRequestLog({ ...logCtx, req, statusCode: 500, error });
  }
}

async function handleHtmlReport(req, res) {
  const logCtx = startRequestLog(req, res);

  try {
    const data = await getNowReportData(req, logCtx.traceId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderReportHtml(data));
    endRequestLog({ ...logCtx, req, statusCode: 200 });
  } catch (error) {
    res.status(500).send(
      renderReportHtml({
        captured_at: new Date().toISOString(),
        source_url: '',
        cuarteles: [],
        error: error.message || 'Unexpected error'
      })
    );
    endRequestLog({ ...logCtx, req, statusCode: 500, error });
  }
}

async function handleSiacResumen(req, res) {
  const logCtx = startRequestLog(req, res);

  try {
    const data = await getSiacResumenData(req, logCtx.traceId);
    res.json(data);
    endRequestLog({ ...logCtx, req, statusCode: 200 });
  } catch (error) {
    res.status(500).json({
      error: error.message || 'Unexpected error',
      hint: 'Check CREW_USERNAME/CREW_PASSWORD and network connectivity.'
    });
    endRequestLog({ ...logCtx, req, statusCode: 500, error });
  }
}

async function handleHabilitaciones(req, res) {
  const logCtx = startRequestLog(req, res);

  try {
    const data = await getHabilitacionesData(req, logCtx.traceId);
    res.json(data);
    endRequestLog({ ...logCtx, req, statusCode: 200 });
  } catch (error) {
    res.status(500).json({
      error: error.message || 'Unexpected error',
      hint: 'Check CREW_USERNAME/CREW_PASSWORD and network connectivity.'
    });
    endRequestLog({ ...logCtx, req, statusCode: 500, error });
  }
}

async function handleSiacResumenHtml(req, res) {
  const logCtx = startRequestLog(req, res);

  try {
    const data = await getSiacResumenData(req, logCtx.traceId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderSiacResumenHtml(data));
    endRequestLog({ ...logCtx, req, statusCode: 200 });
  } catch (error) {
    res.status(500).send(
      renderSiacResumenHtml({
        captured_at: new Date().toISOString(),
        source_url: '',
        companias: [],
        total_companias: 0,
        total_carros: 0,
        error: error.message || 'Unexpected error'
      })
    );
    endRequestLog({ ...logCtx, req, statusCode: 500, error });
  }
}

async function handleHabilitacionesHtml(req, res) {
  const logCtx = startRequestLog(req, res);

  try {
    const data = await getHabilitacionesData(req, logCtx.traceId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderHabilitacionesHtml(data));
    endRequestLog({ ...logCtx, req, statusCode: 200 });
  } catch (error) {
    res.status(500).send(
      renderHabilitacionesHtml({
        captured_at: new Date().toISOString(),
        source_url: '',
        titulo: 'Totales por Habilitación',
        columnas: [],
        filas: [],
        error: error.message || 'Unexpected error'
      })
    );
    endRequestLog({ ...logCtx, req, statusCode: 500, error });
  }
}

async function handleGuardiaReport(req, res) {
  const logCtx = startRequestLog(req, res);

  try {
    const data = await getGuardiaReportData(req, logCtx.traceId);
    res.json(data);
    endRequestLog({ ...logCtx, req, statusCode: 200 });
  } catch (error) {
    res.status(500).json({
      error: error.message || 'Unexpected error',
      hint: 'Check CREW_USERNAME/CREW_PASSWORD and network connectivity.'
    });
    endRequestLog({ ...logCtx, req, statusCode: 500, error });
  }
}

async function handleGuardiaReportHtml(req, res) {
  const logCtx = startRequestLog(req, res);

  try {
    const data = await getGuardiaReportData(req, logCtx.traceId);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(renderGuardiaReportHtml(data));
    endRequestLog({ ...logCtx, req, statusCode: 200 });
  } catch (error) {
    res.status(500).send(
      renderGuardiaReportHtml({
        captured_at: new Date().toISOString(),
        source_urls: {},
        tipos_unidades: [],
        metricas: {
          total_bomberos_guardia: 0,
          total_companias_servicio: 0,
          total_conductores_servicio: 0,
          resumen_unidades_servicio: {}
        },
        filas: [],
        error: error.message || 'Unexpected error'
      })
    );
    endRequestLog({ ...logCtx, req, statusCode: 500, error });
  }
}

app.get('/report', handleJsonReport);
app.get('/report/query', handleJsonReport);
app.get('/report/view', handleHtmlReport);
app.get('/report/view/query', handleHtmlReport);
app.get('/report/siac/resumen', handleSiacResumen);
app.get('/report/siac/resumen/view', handleSiacResumenHtml);
app.get('/report/cuarteles/todo/habilitaciones', handleHabilitaciones);
app.get('/report/cuarteles/todo/habilitaciones/view', handleHabilitacionesHtml);
app.get('/report/guardia', handleGuardiaReport);
app.get('/report/guardia/view', handleGuardiaReportHtml);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  writeLog('info', 'server_started', { port });
});
