const HABILITACIONES_CBT = [
  { id: 175, nombre: 'Operativo', descripcion: 'Bombero Operativo', background_color: '#ff0101', text_color: '#ffffff' },
  { id: 176, nombre: 'Profesional', descripcion: 'Bombero Profesional', background_color: '#0454be', text_color: '#ffffff' },
  { id: 177, nombre: 'Inicial', descripcion: 'Bombero Inicial', background_color: '#00bdff', text_color: '#ffffff' },
  { id: 1169, nombre: 'Inicial', descripcion: 'Bombero Inicial', background_color: '#000000', text_color: '#ffffff' },
  { id: 1170, nombre: 'Operativo', descripcion: 'Bombero Operativo', background_color: '#000000', text_color: '#ffffff' },
  { id: 1172, nombre: 'Rescatista', descripcion: 'Operador de Rescate Vehicular', background_color: '#fd0b00', text_color: '#ffffff' },
  { id: 1173, nombre: 'Haz-Mat', descripcion: 'Operador Haz-Mat', background_color: '#fdeb00', text_color: '#000000' },
  { id: 1174, nombre: 'Conductor', descripcion: 'Conductor Material Mayor', background_color: '#0e9200', text_color: '#ffffff' },
  { id: 1175, nombre: 'USAR', descripcion: 'Miembro Grupo USAR', background_color: '#1288cc', text_color: '#ffffff' },
  { id: 1176, nombre: 'Telecomunicaciones', descripcion: 'Operador de Central', background_color: '#60e838', text_color: '#000000' },
  { id: 1186, nombre: 'Asistente de Trauma', descripcion: 'Asistente de Trauma', background_color: '#85daff', text_color: '#ffffff' },
  { id: 1187, nombre: 'Dron Operador', descripcion: 'Operador de Dron', background_color: '#9e02fa', text_color: '#ffffff' },
  { id: 1188, nombre: 'Forestal Bombero', descripcion: 'Bombero Forestal', background_color: '#f67400', text_color: '#ffffff' },
  { id: 1189, nombre: 'Integrante Fuerza de Tarea Forestal', descripcion: 'Integrante Fuerza de Tarea Forestal', background_color: '#ff5600', text_color: '#ffffff' },
  { id: 1190, nombre: 'SCI', descripcion: 'SCI', background_color: '#00a403', text_color: '#ffffff' },
  { id: 1192, nombre: 'Tecnico HAZMAT', descripcion: 'Tecnico HAZMAT', background_color: '#f8ee0a', text_color: '#1c1b1b' },
  { id: 1193, nombre: 'Especialista HAZMAT', descripcion: 'Especialista HAZMAT', background_color: '#effa0b', text_color: '#0b0b0b' },
  { id: 1194, nombre: 'Tecnico Gersa', descripcion: 'Tecnico Gersa', background_color: '#0762f1', text_color: '#ffffff' },
  { id: 1195, nombre: 'Operador Gersa', descripcion: 'Operador Gersa', background_color: '#0f6fed', text_color: '#ffffff' },
  { id: 1211, nombre: 'Mecanica Operador', descripcion: 'Operador Mecanica', background_color: '#32ab9f', text_color: '#0f0e0e' },
  { id: 1212, nombre: 'Brazo Operador', descripcion: 'Operador Brazo Articulado', background_color: '#7b9ee2', text_color: '#0f0f0f' },
  { id: 1213, nombre: 'Especialista GERSA', descripcion: 'Especialista GERSA', background_color: '#000000', text_color: '#05eff8' },
  { id: 1214, nombre: 'Grimp Operador', descripcion: 'Operador GRIMP', background_color: '#f46363', text_color: '#262223' }
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function toHexByte(value) {
  const bounded = Math.max(0, Math.min(255, value));
  return bounded.toString(16).padStart(2, '0');
}

function normalizeColor(value) {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw || raw === 'transparent') return null;

  const hex3 = raw.match(/^#([0-9a-f]{3})$/i);
  if (hex3) {
    const [r, g, b] = hex3[1].split('');
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  const hex6 = raw.match(/^#([0-9a-f]{6})$/i);
  if (hex6) return `#${hex6[1].toLowerCase()}`;

  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(',').map((part) => part.trim());
    if (parts.length >= 3) {
      const [r, g, b] = parts.slice(0, 3).map((part) => {
        if (part.endsWith('%')) {
          const pct = Number(part.slice(0, -1));
          if (!Number.isFinite(pct)) return 0;
          return Math.round((pct / 100) * 255);
        }
        const num = Number(part);
        return Number.isFinite(num) ? Math.round(num) : 0;
      });
      return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
    }
  }

  return null;
}

function extractColorFromStyle(style, cssProperty) {
  const raw = String(style || '');
  if (!raw) return null;
  const regex = new RegExp(`${cssProperty}\\s*:\\s*([^;]+)`, 'i');
  const match = raw.match(regex);
  if (!match) return null;
  return normalizeColor(match[1]);
}

const MAP_BY_BG_AND_TEXT = new Map();
const MAP_BY_BG = new Map();

for (const item of HABILITACIONES_CBT) {
  const bg = normalizeColor(item.background_color);
  const fg = normalizeColor(item.text_color);
  const bgAndTextKey = `${bg || ''}|${fg || ''}`;

  if (!MAP_BY_BG_AND_TEXT.has(bgAndTextKey)) MAP_BY_BG_AND_TEXT.set(bgAndTextKey, []);
  MAP_BY_BG_AND_TEXT.get(bgAndTextKey).push(item);

  if (!MAP_BY_BG.has(bg || '')) MAP_BY_BG.set(bg || '', []);
  MAP_BY_BG.get(bg || '').push(item);
}

function chooseByTagLabel(candidates, tagLabel) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const normalizedLabel = normalizeText(tagLabel);
  if (!normalizedLabel) return null;

  if (normalizedLabel.length === 1) {
    const byInitial = candidates.find((item) => normalizeText(item.nombre).startsWith(normalizedLabel));
    if (byInitial) return byInitial;
  }

  const byName = candidates.find((item) => normalizeText(item.nombre).includes(normalizedLabel));
  if (byName) return byName;

  const byDescription = candidates.find((item) => normalizeText(item.descripcion).includes(normalizedLabel));
  if (byDescription) return byDescription;

  return null;
}

function mapTagToHabilitacion(tag) {
  const tagObject = typeof tag === 'string' ? { label: tag } : tag;
  const label = String(tagObject?.label || '').trim();
  const bgComputed = normalizeColor(tagObject?.background_color);
  const fgComputed = normalizeColor(tagObject?.text_color);
  const inlineBg = extractColorFromStyle(tagObject?.style, 'background(?:-color)?');
  const inlineFg = extractColorFromStyle(tagObject?.style, 'color');
  const backgroundColor = bgComputed || inlineBg;
  const textColor = fgComputed || inlineFg;

  let candidates = [];
  let matchType = 'none';

  const exactKey = `${backgroundColor || ''}|${textColor || ''}`;
  if (MAP_BY_BG_AND_TEXT.has(exactKey)) {
    candidates = MAP_BY_BG_AND_TEXT.get(exactKey);
    matchType = 'exact_color_pair';
  } else if (MAP_BY_BG.has(backgroundColor || '')) {
    candidates = MAP_BY_BG.get(backgroundColor || '');
    matchType = 'background_only';
  }

  const selected = chooseByTagLabel(candidates, label) || (candidates.length === 1 ? candidates[0] : null);
  const isAmbiguous = !selected && candidates.length > 1;

  return {
    label,
    background_color: backgroundColor,
    text_color: textColor,
    match_type: matchType,
    habilitacion: selected
      ? {
          id: selected.id,
          nombre: selected.nombre,
          descripcion: selected.descripcion,
          background_color: selected.background_color,
          text_color: selected.text_color
        }
      : null,
    candidatos: isAmbiguous
      ? candidates.map((item) => ({
          id: item.id,
          nombre: item.nombre,
          descripcion: item.descripcion,
          background_color: item.background_color,
          text_color: item.text_color
        }))
      : []
  };
}

function enrichPersonTags(person) {
  const rawTags = Array.isArray(person?.tags) ? person.tags : [];
  const tagsDetalle = rawTags.map(mapTagToHabilitacion);

  const seenHabilitacion = new Set();
  const habilitacionesDetalle = [];
  for (const tag of tagsDetalle) {
    if (!tag?.habilitacion) continue;
    const key = `${tag.habilitacion.id}`;
    if (seenHabilitacion.has(key)) continue;
    seenHabilitacion.add(key);
    habilitacionesDetalle.push(tag.habilitacion);
  }

  return {
    ...person,
    tags: rawTags
      .map((tag) => {
        if (typeof tag === 'string') return String(tag).trim();
        return String(tag?.label || '').trim();
      })
      .filter(Boolean),
    tags_detalle: tagsDetalle,
    habilitaciones: habilitacionesDetalle.map((item) => item.nombre),
    habilitaciones_detalle: habilitacionesDetalle
  };
}

function enrichCuartelesTags(cuarteles) {
  const list = Array.isArray(cuarteles) ? cuarteles : [];
  return list.map((cuartel) => {
    const personal = Array.isArray(cuartel?.personal) ? cuartel.personal : [];
    return {
      ...cuartel,
      personal: personal.map(enrichPersonTags)
    };
  });
}

module.exports = {
  HABILITACIONES_CBT,
  normalizeColor,
  enrichPersonTags,
  enrichCuartelesTags
};
