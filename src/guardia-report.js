const UNIT_TYPES = ['B', 'BX', 'Q', 'M', 'QM', 'GR', 'H', 'BH', 'BR', 'RX', 'K', 'S', 'Z', 'MX'];
const DEFAULT_VALID_STATES = ['DISPONIBLE'];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toNumberOrZero(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function companyKeyFromName(name) {
  const normalized = normalizeText(name);
  if (!normalized) return '';

  if (normalized.includes('general')) return 'general';
  if (/\bbm\b/.test(normalized) || normalized === 'b.m' || normalized === 'b m') return 'bm';
  if (/\basr\b/.test(normalized) || normalized.includes('a.s.r')) return 'asr';

  const numberMatch = normalized.match(/\d+/);
  if (numberMatch) return numberMatch[0];

  return normalized;
}

function isConductorNameValid(name) {
  const value = String(name || '').trim();
  if (!value) return false;
  if (['-', '--', 'n/a', 'na'].includes(value.toLowerCase())) return false;
  return true;
}

function normalizeStateFilters(values) {
  const arrayValues = Array.isArray(values) ? values : [];
  const seen = new Set();
  const normalized = [];
  for (const raw of arrayValues) {
    const key = normalizeText(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function resolveValidStateFilters(rawFilters) {
  const normalized = normalizeStateFilters(rawFilters);
  if (normalized.length > 0) return normalized;
  return normalizeStateFilters(DEFAULT_VALID_STATES);
}

function resolveValidStateLabels(rawFilters) {
  const values = Array.isArray(rawFilters) ? rawFilters : [];
  const labels = uniqueStrings(values);
  if (labels.length > 0) return labels;
  return [...DEFAULT_VALID_STATES];
}

function isEstadoValido(estado, validStateFilters) {
  const normalized = normalizeText(estado);
  if (!normalized) return false;
  return validStateFilters.includes(normalized);
}

function isCarroInService(carro) {
  const disponible = normalizeText(carro?.disponible);
  const disponibleOperativa = carro?.disponible_operativa === true;
  const enEmergencia = carro?.en_emergencia === true;
  const conductor = carro?.conductor;
  return (disponible === 'si' || disponible === 'sí' || disponibleOperativa || enEmergencia) && isConductorNameValid(conductor);
}

function detectUnitType(carroName) {
  const cleaned = String(carroName || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');

  if (!cleaned) return null;

  const byLength = [...UNIT_TYPES].sort((a, b) => b.length - a.length);
  return byLength.find((type) => cleaned.startsWith(type)) || null;
}

function uniqueStrings(values) {
  const seen = new Set();
  const output = [];
  for (const raw of values || []) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = normalizeText(value);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output;
}

function isOficialByCargo(cargo) {
  const normalized = normalizeText(cargo);
  if (!normalized) return false;

  const officialHints = [
    'superintendente',
    'vicesuperintendente',
    'comandante',
    'capitan',
    'teniente',
    'inspector',
    'oficial',
    'ayudante'
  ];

  return officialHints.some((hint) => normalized.includes(hint));
}

function buildOficialesDetalle(personal) {
  const rows = Array.isArray(personal) ? personal : [];
  const seen = new Set();
  const output = [];

  for (const persona of rows) {
    const nombre = String(persona?.nombre || '').trim();
    if (!nombre) continue;
    const key = normalizeText(nombre);
    if (seen.has(key)) continue;
    seen.add(key);

    output.push({
      nombre,
      cargo: String(persona?.cargo || '').trim() || null,
      estado: String(persona?.estado || '').trim() || null,
      es_oficial: isOficialByCargo(persona?.cargo)
    });
  }

  return output;
}

function collectEstadosDisponibles(cuartelesAhora) {
  const rows = Array.isArray(cuartelesAhora) ? cuartelesAhora : [];
  const states = [];
  for (const cuartel of rows) {
    const personal = Array.isArray(cuartel?.personal) ? cuartel.personal : [];
    for (const persona of personal) {
      const estado = String(persona?.estado || '').trim();
      if (!estado) continue;
      states.push(estado);
    }
  }

  const uniqueStates = uniqueStrings(states);
  if (uniqueStates.length > 0) return uniqueStates;
  return [...DEFAULT_VALID_STATES];
}

function buildCuartelesByCompanyMap(cuartelesAhora, validStateFilters) {
  const rows = Array.isArray(cuartelesAhora) ? cuartelesAhora : [];
  const byCompany = new Map();

  for (const cuartel of rows) {
    const key = companyKeyFromName(cuartel?.cuartel);
    const personal = Array.isArray(cuartel?.personal) ? cuartel.personal : [];
    const personalValido = personal.filter((p) => isEstadoValido(p?.estado, validStateFilters));
    const oficialesDetalle = buildOficialesDetalle(personal);
    const oficialesFiltrados = uniqueStrings(personalValido.map((p) => p?.nombre));
    byCompany.set(key, {
      cuartel: cuartel?.cuartel || '',
      n_bomberos: personalValido.length,
      oficiales_disponibles: uniqueStrings(personal.map((p) => p?.nombre)),
      oficiales_detalle: oficialesDetalle,
      oficiales_filtrados: oficialesFiltrados,
      personal_valido: personalValido
    });
  }

  return byCompany;
}

function summarizeHabilitaciones(personalValido) {
  const counts = new Map();
  const people = Array.isArray(personalValido) ? personalValido : [];

  for (const persona of people) {
    const rawHabilitaciones = Array.isArray(persona?.habilitaciones)
      ? persona.habilitaciones
      : Array.isArray(persona?.habilitaciones_detalle)
      ? persona.habilitaciones_detalle.map((item) => item?.nombre)
      : [];

    const personaHabilitaciones = uniqueStrings(rawHabilitaciones);
    for (const nombre of personaHabilitaciones) {
      counts.set(nombre, (counts.get(nombre) || 0) + 1);
    }
  }

  const entries = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0], 'es', { sensitivity: 'base' });
  });

  const detalleHabilitaciones = Object.fromEntries(entries);
  const resumenHabilitaciones = entries.map(([nombre, cantidad]) => `${cantidad} ${nombre}`);
  const totalEspecialistas = entries.reduce((acc, [, cantidad]) => acc + cantidad, 0);

  return {
    total_especialistas: totalEspecialistas,
    detalle_habilitaciones: detalleHabilitaciones,
    resumen_habilitaciones: resumenHabilitaciones,
    resumen_habilitaciones_texto: resumenHabilitaciones.join(' / ')
  };
}

function buildGuardiaRows(snapshot, options = {}) {
  const siac = snapshot?.siac_resumen || {};
  const companias = Array.isArray(siac?.companias) ? siac.companias : [];
  const validStateFilters = resolveValidStateFilters(options.estadosValidos);

  const cuartelesByCompany = buildCuartelesByCompanyMap(snapshot?.cuarteles_ahora, validStateFilters);

  return companias.map((compania) => {
    const companiaName = compania?.compania || '';
    const companiaKey = companyKeyFromName(companiaName);
    const cuartelData = cuartelesByCompany.get(companiaKey) || null;

    const carros = Array.isArray(compania?.carros) ? compania.carros : [];
    const carrosEnServicio = carros.filter(isCarroInService);

    const conductores = uniqueStrings(carrosEnServicio.map((carro) => carro?.conductor));
    let fallbackCount = 0;
    if (validStateFilters.length === 1 && validStateFilters[0] === normalizeText('disponible')) {
      fallbackCount = toNumberOrZero(compania?.personal_resumen?.disponibles);
    }
    const nBomberos = cuartelData ? toNumberOrZero(cuartelData.n_bomberos) : fallbackCount;
    const tieneUnidadEnServicio = carrosEnServicio.length > 0;
    const estado = tieneUnidadEnServicio && nBomberos > 0 ? '0-9' : '0-8';
    const habilitaciones = summarizeHabilitaciones(cuartelData?.personal_valido || []);

    const unidades = UNIT_TYPES.reduce((acc, type) => {
      acc[type] = 0;
      return acc;
    }, {});

    for (const carro of carrosEnServicio) {
      const unitType = detectUnitType(carro?.carro);
      if (!unitType || !(unitType in unidades)) continue;
      unidades[unitType] += 1;
    }

    return {
      compania: companiaName,
      compania_key: companiaKey,
      cuartel: cuartelData?.cuartel || null,
      estado,
      oficiales_disponibles: cuartelData?.oficiales_disponibles || [],
      oficiales_detalle: cuartelData?.oficiales_detalle || [],
      oficiales_filtrados: cuartelData?.oficiales_filtrados || [],
      n_bomberos: nBomberos,
      total_especialistas: toNumberOrZero(habilitaciones.total_especialistas),
      detalle_habilitaciones: habilitaciones.detalle_habilitaciones,
      resumen_habilitaciones: habilitaciones.resumen_habilitaciones,
      resumen_habilitaciones_texto: habilitaciones.resumen_habilitaciones_texto,
      conductores,
      observaciones: '',
      unidades,
      carros_en_servicio: carrosEnServicio.map((carro) => ({
        carro: carro?.carro || '',
        conductor: carro?.conductor || '',
        estado: carro?.estado || '',
        disponible: carro?.disponible || '',
        mecanica: carro?.mecanica || '',
        en_emergencia: carro?.en_emergencia === true,
        disponible_operativa: carro?.disponible_operativa === true,
        ui_background_color: carro?.ui_background_color || null
      }))
    };
  });
}

function filterRowsByCompania(rows, companiaFilterRaw) {
  if (!companiaFilterRaw) return rows;
  const normalizedFilter = normalizeText(companiaFilterRaw);
  if (!normalizedFilter) return rows;

  if (/^\d+$/.test(normalizedFilter)) {
    return rows.filter((row) => {
      const matches = (row?.compania_key || '').match(/\d+/g) || [];
      return matches.includes(normalizedFilter);
    });
  }

  return rows.filter((row) => normalizeText(row?.compania || '').includes(normalizedFilter));
}

function buildMetricas(rows) {
  const metricas = {
    total_bomberos_guardia: 0,
    total_companias_servicio: 0,
    total_conductores_servicio: 0,
    resumen_unidades_servicio: UNIT_TYPES.reduce((acc, type) => {
      acc[type] = 0;
      return acc;
    }, {})
  };

  for (const row of rows) {
    metricas.total_bomberos_guardia += toNumberOrZero(row?.n_bomberos);
    if (row?.estado === '0-9') metricas.total_companias_servicio += 1;
    metricas.total_conductores_servicio += Array.isArray(row?.conductores) ? row.conductores.length : 0;

    for (const type of UNIT_TYPES) {
      metricas.resumen_unidades_servicio[type] += toNumberOrZero(row?.unidades?.[type]);
    }
  }

  return metricas;
}

function buildGuardiaReport(snapshot, options = {}) {
  const companiaFilterRaw = options.compania || null;
  const estadosDisponibles = collectEstadosDisponibles(snapshot?.cuarteles_ahora);
  const estadosValidos = resolveValidStateLabels(options.estadosValidos);
  const rows = buildGuardiaRows(snapshot, { estadosValidos });
  const filteredRows = filterRowsByCompania(rows, companiaFilterRaw);

  return {
    captured_at: snapshot?.captured_at || new Date().toISOString(),
    source_urls: snapshot?.source_urls || {},
    filtros_aplicados: {
      compania: companiaFilterRaw,
      estados_validos: estadosValidos
    },
    estados_disponibles: estadosDisponibles,
    tipos_unidades: UNIT_TYPES,
    metricas: buildMetricas(filteredRows),
    filas: filteredRows
  };
}

module.exports = {
  UNIT_TYPES,
  DEFAULT_VALID_STATES,
  buildGuardiaReport
};
