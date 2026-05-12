const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

const { chromium } = require('playwright');

function readArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

function resolvePath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

function waitForEnter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

async function main() {
  const baseUrl = (readArg('--base-url') || process.env.CREW_BASE_URL || 'https://crew.viper.cl').replace(/\/$/, '');
  const outputPath = resolvePath(readArg('--output') || process.env.SESSION_EXPORT_FILE || '.session/crew-storage-state.json');
  const timeoutMs = Number(readArg('--timeout-ms') || process.env.TIMEOUT_MS || 120000);
  const loginUrl = `${baseUrl}/cuarteles/ahora`;

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    slowMo: Number(process.env.SLOW_MO || 0)
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(timeoutMs);

  try {
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    console.log('\nInicia sesion manualmente en la ventana de Chromium.');
    console.log('Resuelve el captcha si aparece y espera hasta ver el sistema cargado.');
    await waitForEnter(`\nCuando estes dentro de ${loginUrl}, presiona Enter aqui para guardar la sesion... `);

    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    const loginUser = page.getByRole('textbox', { name: /usuario/i });
    const loginVisible =
      (await loginUser.count()) > 0 ? await loginUser.first().isVisible().catch(() => false) : false;

    if (loginVisible) {
      throw new Error('El formulario de login sigue visible. No se guardo la sesion porque aun no esta autenticada.');
    }

    await context.storageState({ path: outputPath });
    console.log(`\nSesion guardada en: ${outputPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
