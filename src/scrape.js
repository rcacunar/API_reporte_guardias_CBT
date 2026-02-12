const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { writeLog } = require('./logger');
const { enrichCuartelesTags } = require('./habilitaciones-map');

function parseBooleanEnv(value, defaultValue) {
  if (value === undefined) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n'].includes(normalized)) return false;
  return defaultValue;
}

function resolveSessionFilePath(sessionFilePath) {
  if (!sessionFilePath) return null;
  return path.isAbsolute(sessionFilePath) ? sessionFilePath : path.resolve(process.cwd(), sessionFilePath);
}

async function saveSessionState(context, storageStatePath) {
  if (!storageStatePath) return;
  await fs.promises.mkdir(path.dirname(storageStatePath), { recursive: true });
  await context.storageState({ path: storageStatePath });
}

async function waitForCuartelesAhoraPage(page) {
  await page.waitForFunction(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.some((table) => {
      const headerRow = table.querySelector(':scope > tbody > tr');
      if (!headerRow) return false;
      const headerText = Array.from(headerRow.querySelectorAll(':scope > th, :scope > td'))
        .map((cell) => (cell.innerText || '').trim())
        .join('|');
      return headerText.includes('Cuartel') && headerText.includes('Disponibles') && headerText.includes('Personal');
    });
  });
}

async function extractCuartelesAhora(page) {
  const rawData = await page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

    const findMainTable = () => {
      const tables = Array.from(document.querySelectorAll('table'));
      return tables.find((table) => {
        const headerRow = table.querySelector(':scope > tbody > tr');
        if (!headerRow) return false;
        const headerText = Array.from(headerRow.querySelectorAll(':scope > th, :scope > td'))
          .map((cell) => normalize(cell.innerText))
          .join('|');
        return headerText.includes('Cuartel') && headerText.includes('Disponibles') && headerText.includes('Personal');
      });
    };

    const parsePersonCell = (cell) => {
      const card = cell.querySelector(':scope > div');
      if (!card) return null;

      const directDivs = Array.from(card.children).filter((el) => el.tagName === 'DIV');
      const tagDivs = directDivs.filter((div) => /width:\s*18px/i.test(div.getAttribute('style') || ''));
      const tags = tagDivs
        .map((div) => {
          const computed = window.getComputedStyle(div);
          return {
            label: normalize(div.textContent),
            style: div.getAttribute('style') || '',
            background_color: computed?.backgroundColor || '',
            text_color: computed?.color || ''
          };
        })
        .filter((tag) => Boolean(tag.label));

      const nameDiv = directDivs.find((div) => {
        const style = div.getAttribute('style') || '';
        return /height:\s*30px/i.test(style) || /overflow:\s*hidden/i.test(style);
      });
      const nombre = nameDiv ? normalize(nameDiv.textContent) : null;

      const numberDiv = directDivs.find((div) => /^\d+$/.test(normalize(div.textContent)));
      const registro = numberDiv ? normalize(numberDiv.textContent) : null;

      let cargo = null;
      if (numberDiv) {
        const startIndex = directDivs.indexOf(numberDiv) + 1;
        for (let i = startIndex; i < directDivs.length; i += 1) {
          const div = directDivs[i];
          const style = div.getAttribute('style') || '';
          if (/width:\s*18px/i.test(style)) continue;
          if (div === nameDiv) continue;
          if (/height:\s*30px/i.test(style) || /overflow:\s*hidden/i.test(style)) continue;
          const text = normalize(div.textContent);
          if (text) {
            cargo = text;
            break;
          }
        }
      }
      if (cargo === '-') cargo = null;

      const statusDiv =
        card.querySelector('a[href*="cambiar_estado"] div') ||
        card.querySelector('a[title*="Cambiar Estado"] div');
      const estado = statusDiv ? normalize(statusDiv.textContent) : null;

      const statusHref = statusDiv ? statusDiv.parentElement.getAttribute('href') : null;
      const eliminarLink = card.querySelector('a[href*="eliminar_bombero"]');
      const eliminarHref = eliminarLink ? eliminarLink.getAttribute('href') : null;

      let eliminarId = null;
      if (eliminarHref) {
        try {
          const url = new URL(eliminarHref, location.origin);
          eliminarId = url.searchParams.get('eliminar_bombero');
        } catch (error) {
          eliminarId = null;
        }
      }

      return {
        registro,
        cargo,
        estado,
        nombre,
        tags,
        cambiar_estado_url: statusHref,
        eliminar_id: eliminarId,
        eliminar_url: eliminarHref
      };
    };

    const table = findMainTable();
    if (!table) {
      return {
        cuarteles: [],
        error: 'main_table_not_found'
      };
    }

    const rows = Array.from(table.querySelectorAll(':scope > tbody > tr'));
    const dataRows = rows.slice(1);

    const cuarteles = dataRows
      .map((row) => {
        const cells = Array.from(row.querySelectorAll(':scope > td'));
        const cuartel = normalize(cells[0]?.innerText || '');
        const disponiblesRaw = normalize(cells[1]?.innerText || '');
        const disponibles = Number.isFinite(Number(disponiblesRaw)) ? Number(disponiblesRaw) : null;

        const personalCell = cells[2];
        let personal = [];
        if (personalCell) {
          const personTable = personalCell.querySelector('table');
          if (personTable) {
            const personCells = Array.from(personTable.querySelectorAll(':scope > tbody > tr > td'));
            personal = personCells
              .map(parsePersonCell)
              .filter(Boolean);
          }
        }

        return {
          cuartel,
          disponibles,
          total_personal: personal.length,
          personal
        };
      })
      .filter((entry) => entry.cuartel);

    return { cuarteles };
  });

  return {
    ...rawData,
    cuarteles: enrichCuartelesTags(rawData?.cuarteles)
  };
}

async function waitForSiacResumenPage(page) {
  await page.waitForSelector('.row.fila', { state: 'attached' });
  await page.waitForSelector('button.cuadro_vehiculo', { state: 'attached' });
}

async function extractSiacResumen(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    const normalizeKey = (value) =>
      normalize(value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();

    const parseCarPanel = (panelEl) => {
      if (!panelEl) return null;
      const rows = Array.from(panelEl.querySelectorAll('table tr'));
      const mapped = {};

      rows.forEach((row) => {
        const tds = Array.from(row.querySelectorAll('td'));
        if (tds.length < 2) return;
        const key = normalizeKey(tds[0].textContent);
        const value = normalize(tds[1].textContent);
        if (key) mapped[key] = value || null;
      });

      return {
        carro: mapped.carro || null,
        estado: mapped.estado || null,
        conductor: mapped.conductor || null,
        disponible: mapped.disponible || null,
        mecanica: mapped.mecanica || null
      };
    };

    const parsePersonalResumen = (rowEl) => {
      const personalCell = rowEl.querySelector('.col_personal');
      if (!personalCell) return { disponibles: null, total: null };

      const disponiblesRaw =
        personalCell.querySelector('[id^="disponibles_"]')?.textContent ||
        personalCell.querySelector('tr:first-child td:last-child')?.textContent ||
        '';
      const totalRaw =
        personalCell.querySelector('[id^="total_"]')?.textContent ||
        personalCell.querySelector('tr:last-child td:last-child')?.textContent ||
        '';

      const disponiblesNum = Number(normalize(disponiblesRaw));
      const totalNum = Number(normalize(totalRaw));

      return {
        disponibles: Number.isFinite(disponiblesNum) ? disponiblesNum : null,
        total: Number.isFinite(totalNum) ? totalNum : null
      };
    };

    const rows = Array.from(document.querySelectorAll('.row.fila'));

    const companias = rows
      .map((rowEl) => {
        const compania = normalize(rowEl.querySelector('.col_cia .cia')?.textContent || '');
        if (!compania) return null;

        const carros = Array.from(rowEl.querySelectorAll('.col_carros button.cuadro_vehiculo')).map((button) => {
          const carroNombre = normalize(button.textContent);
          const onclick = button.getAttribute('onclick') || '';
          const panelIdMatch = onclick.match(/mostrar\('([^']+)'\)/i);
          const panelId = panelIdMatch ? panelIdMatch[1] : null;
          const panelEl = panelId ? document.getElementById(panelId) : null;
          const panelData = parseCarPanel(panelEl) || {};

          return {
            carro: panelData.carro || carroNombre || null,
            estado: panelData.estado || null,
            conductor: panelData.conductor || null,
            disponible: panelData.disponible || null,
            mecanica: panelData.mecanica || null
          };
        });

        return {
          compania,
          carros,
          personal_resumen: parsePersonalResumen(rowEl)
        };
      })
      .filter(Boolean);

    const totalCarros = companias.reduce((sum, item) => sum + (item.carros?.length || 0), 0);

    return {
      companias,
      total_companias: companias.length,
      total_carros: totalCarros
    };
  });
}

async function waitForHabilitacionesPage(page) {
  await page.waitForFunction(() => {
    const title = Array.from(document.querySelectorAll('.box-title h3')).find((el) =>
      (el.textContent || '').toLowerCase().includes('totales por habilitación') ||
      (el.textContent || '').toLowerCase().includes('totales por habilitacion')
    );
    if (!title) return false;
    const table = title.closest('.box')?.querySelector('table');
    return Boolean(table && table.querySelector('thead th') && table.querySelector('tbody tr'));
  });
}

async function extractHabilitaciones(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

    const heading = Array.from(document.querySelectorAll('.box-title h3')).find((el) => {
      const text = normalize(el.textContent).toLowerCase();
      return text.includes('totales por habilitación') || text.includes('totales por habilitacion');
    });

    const table = heading?.closest('.box')?.querySelector('table') || null;
    if (!table) {
      return {
        titulo: 'Totales por Habilitación',
        columnas: [],
        filas: [],
        error: 'habilitaciones_table_not_found'
      };
    }

    const columnas = Array.from(table.querySelectorAll('thead tr:first-child th')).map((th) => normalize(th.textContent));

    const filas = Array.from(table.querySelectorAll('tbody tr')).map((tr) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((td) => normalize(td.textContent));
      const habilitacion = cells[0] || null;

      const valores = {};
      for (let i = 1; i < columnas.length; i += 1) {
        const columnName = columnas[i];
        const raw = cells[i] || '';
        if (raw === '') {
          valores[columnName] = null;
        } else {
          const numeric = Number(raw);
          valores[columnName] = Number.isFinite(numeric) ? numeric : raw;
        }
      }

      return {
        habilitacion,
        valores
      };
    });

    return {
      titulo: normalize(heading?.textContent || 'Totales por Habilitación'),
      columnas,
      filas
    };
  });
}

async function ensureSessionAndLogin({ page, username, password, cuartelesAhoraUrl, traceId, storageStatePath }) {
  await page.goto(cuartelesAhoraUrl, { waitUntil: 'domcontentloaded' });

  const loginUser = page.getByRole('textbox', { name: /usuario/i });
  const loginVisible =
    (await loginUser.count()) > 0 ? await loginUser.first().isVisible().catch(() => false) : false;

  writeLog('info', 'crew_session_check', {
    traceId,
    loginRequired: loginVisible
  });

  if (!loginVisible) {
    writeLog('info', 'crew_session_reused', { traceId });
    return;
  }

  writeLog('info', 'crew_login_start', { traceId });
  await loginUser.fill(username);
  await page.getByRole('textbox', { name: /password/i }).fill(password);

  const loginButton = page.getByRole('button', { name: /entrar/i });
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    loginButton.click()
  ]);

  writeLog('info', 'crew_login_success', { traceId });
  await saveSessionState(page.context(), storageStatePath);
  writeLog('info', 'crew_session_saved', { traceId, sessionFilePath: storageStatePath });
}

async function scrapeCrewSnapshot({
  username,
  password,
  baseUrl = 'https://crew.viper.cl',
  headless = true,
  slowMo = 0,
  timeoutMs = 60000,
  persistSession = true,
  sessionFilePath = '.session/crew-storage-state.json',
  traceId
}) {
  if (!username || !password) {
    throw new Error('Missing CREW_USERNAME or CREW_PASSWORD.');
  }

  const safeBaseUrl = baseUrl.replace(/\/$/, '');
  const urls = {
    cuarteles_ahora: `${safeBaseUrl}/cuarteles/ahora`,
    siac_resumen: `${safeBaseUrl}/siac/resumen`,
    cuarteles_todo: `${safeBaseUrl}/cuarteles/todo`
  };

  const storageStatePath = persistSession ? resolveSessionFilePath(sessionFilePath) : null;
  const hasSavedSession = Boolean(storageStatePath && fs.existsSync(storageStatePath));

  writeLog('info', 'scrape_start', {
    traceId,
    baseUrl: safeBaseUrl,
    headless,
    slowMo,
    timeoutMs,
    persistSession,
    hasSavedSession,
    sessionFilePath: storageStatePath
  });

  const browser = await chromium.launch({ headless, slowMo });
  const context = await browser.newContext(hasSavedSession ? { storageState: storageStatePath } : undefined);

  const authPage = await context.newPage();
  authPage.setDefaultTimeout(timeoutMs);

  try {
    await ensureSessionAndLogin({
      page: authPage,
      username,
      password,
      cuartelesAhoraUrl: urls.cuarteles_ahora,
      traceId,
      storageStatePath
    });

    const pageAhora = await context.newPage();
    const pageSiac = await context.newPage();
    const pageTodo = await context.newPage();
    pageAhora.setDefaultTimeout(timeoutMs);
    pageSiac.setDefaultTimeout(timeoutMs);
    pageTodo.setDefaultTimeout(timeoutMs);

    writeLog('info', 'crew_parallel_fetch_start', {
      traceId,
      urls
    });

    await Promise.all([
      pageAhora.goto(urls.cuarteles_ahora, { waitUntil: 'domcontentloaded' }),
      pageSiac.goto(urls.siac_resumen, { waitUntil: 'domcontentloaded' }),
      pageTodo.goto(urls.cuarteles_todo, { waitUntil: 'domcontentloaded' })
    ]);

    await Promise.all([
      waitForCuartelesAhoraPage(pageAhora),
      waitForSiacResumenPage(pageSiac),
      waitForHabilitacionesPage(pageTodo)
    ]);

    const [ahoraData, siacData, habilitacionesData] = await Promise.all([
      extractCuartelesAhora(pageAhora),
      extractSiacResumen(pageSiac),
      extractHabilitaciones(pageTodo)
    ]);

    const capturedAt = new Date().toISOString();

    const snapshot = {
      captured_at: capturedAt,
      source_urls: urls,
      cuarteles_ahora: Array.isArray(ahoraData?.cuarteles) ? ahoraData.cuarteles : [],
      siac_resumen: siacData,
      cuarteles_todo_habilitaciones: habilitacionesData
    };

    writeLog('info', 'scrape_success', {
      traceId,
      sourceUrls: urls,
      cuartelesAhoraCount: snapshot.cuarteles_ahora.length,
      siacCompaniasCount: snapshot.siac_resumen?.total_companias || 0,
      siacCarrosCount: snapshot.siac_resumen?.total_carros || 0,
      habilitacionesRowsCount: Array.isArray(snapshot.cuarteles_todo_habilitaciones?.filas)
        ? snapshot.cuarteles_todo_habilitaciones.filas.length
        : 0
    });

    return snapshot;
  } catch (error) {
    writeLog('error', 'scrape_error', {
      traceId,
      error: error.message || String(error)
    });
    throw error;
  } finally {
    await context.close();
    await browser.close();
    writeLog('debug', 'scrape_resources_closed', { traceId });
  }
}

async function scrapeCrewNow(config) {
  const snapshot = await scrapeCrewSnapshot(config);
  return {
    captured_at: snapshot.captured_at,
    source_url: snapshot.source_urls.cuarteles_ahora,
    cuarteles: snapshot.cuarteles_ahora
  };
}

function getRuntimeConfig(env = process.env) {
  return {
    username: env.CREW_USERNAME,
    password: env.CREW_PASSWORD,
    baseUrl: env.CREW_BASE_URL || 'https://crew.viper.cl',
    headless: parseBooleanEnv(env.HEADLESS, true),
    slowMo: env.SLOW_MO ? Number(env.SLOW_MO) : 0,
    timeoutMs: env.TIMEOUT_MS ? Number(env.TIMEOUT_MS) : 60000,
    persistSession: parseBooleanEnv(env.PERSIST_SESSION, true),
    sessionFilePath: env.SESSION_FILE || '.session/crew-storage-state.json'
  };
}

module.exports = {
  scrapeCrewNow,
  scrapeCrewSnapshot,
  getRuntimeConfig,
  parseBooleanEnv
};
