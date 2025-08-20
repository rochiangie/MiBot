'use strict';

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');
const fs = require('fs');

// ⚙️ CONFIGURACIÓN
const SPECIAL_NUMBER = '5492216303497@c.us';
const ALLOWED_GROUP_IDS = []; // Array vacío para permitir todos los grupos
const MY_NUMBER = '5492216770757@c.us'
// 📁 Ruta PERSISTENTE para la sesión
const DATA_PATH = path.resolve(__dirname, '.wwebjs_auth');

// ===================================
//           UTILIDADES
// ===================================

// LIMPIAR ARCHIVOS DE BLOQUEO ANTES DE INICIAR
function cleanupLockFiles() {
  try {
    const lockPath = path.join(DATA_PATH, 'session-default');
    if (fs.existsSync(lockPath)) {
      const files = fs.readdirSync(lockPath);
      files.forEach(file => {
        if (file.includes('SingletonLock') || file.includes('lock')) {
          fs.unlinkSync(path.join(lockPath, file));
          console.log(`🔓 Eliminado archivo de bloqueo: ${file}`);
        }
      });
    }
  } catch (error) {
    console.log('⚠️ No se pudieron eliminar archivos de bloqueo:', error.message);
  }
}

// Ejecutar limpieza
cleanupLockFiles();

if (!fs.existsSync(DATA_PATH)) {
  try {
    fs.mkdirSync(DATA_PATH, { recursive: true });
    console.log(`Directorio de sesión creado en: ${DATA_PATH}`);
  } catch (e) {
    console.error('Error al crear el directorio de sesión:', e);
  }
}

// ===== Helpers de envío seguros =====
async function safeReply(msg, text) {
  try {
    console.log(`Enviando respuesta: "${text}"`);
    return await msg.reply(text);
  } catch (e) {
    console.error('Error al responder:', e);
  }
}

async function forwardToMe(msg, title) {
  try {
    const chat = await msg.getChat();
    const contact = await msg.getContact();

    const text = `*Reenvío del bot* 🤖\n\n*De:* ${contact.pushname || contact.number} (${chat.isGroup ? 'Grupo' : 'DM'})\n*Pedido:* ${title}\n*Mensaje:* ${msg.body}\n\n[~] ID: ${msg.from}`;

    // Envía el mensaje a tu número (MY_NUMBER)
    await client.sendMessage(MY_NUMBER, text);
    console.log(`✅ Mensaje reenviado a ${MY_NUMBER}`);
  } catch (e) {
    console.error('❌ Error al reenviar el mensaje:', e);
  }
}

// Disparadores para “desmutear”
function isTrigger(text) {
  if (!text || typeof text !== 'string') return false;

  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const greetingRe = /\b(?:h)?o+l+(?:a+(?:s+)?|i+(?:s+)?|u+)\b/;
  const keywordsRe = /\b(menu|ayuda|hi|hello)\b/;

  return greetingRe.test(t) || keywordsRe.test(t);
}

function formatHora(iso) {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return '—:—';
  }
}

// ===================================
//        ESTADO / MEMORIA SIMPLE
// ===================================
const userState = {};   // por chatId: 'idle' | 'menu_principal' | ... | 'muted'
const userInfo  = {};   // datos que deja la persona (ej: motivo, reprogramaciones)
const groupState = {};  // { [groupId]: { ultimosPedidos: [] } }

// ===================================
//      CLIENTE WWEBJS + PUPPETEER
// ===================================

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: DATA_PATH }),
  puppeteer: {
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-extensions'
    ],
    headless: true
  }
});

// ===================================
//           EVENTOS DEL CLIENTE
// ===================================

client.on('qr', qr => {
  console.log('🔐 Escaneá este QR (solo la primera vez):');
  qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
  console.log(`🔄 Cargando: ${percent}% - ${message}`);
  if (percent === 100) console.log('🎯 Carga completada, conectando...');
});

client.on('change_state', (state) => {
  console.log('📡 Estado de WA:', state);
});

client.on('authenticated', () => {
  console.log('✅ Autenticado (sesión guardada).');
});

client.on('auth_failure', msg => {
  console.error('❌ Error de autenticación:', msg);
});

client.on('ready', () => {
  console.log('🤖 Bot de Angie Rochi conectado y listo! 💃🔥');
  console.log(`Número: ${client.info?.wid?.user}`);
});

client.on('disconnected', (reason) => {
  console.log('❌ Desconectado:', reason);
});

client.on('remote_session_saved', () => {
  console.log('💾 Sesión remota guardada');
});

client.on('connection_gained', () => {
  console.log('🟢 Conexión recuperada');
});

client.on('connection_lost', () => {
    console.log(`🟠 Conexión perdida (intentando reconectar)`);
});

client.on('error', (error) => {
  console.error('❌ Error del cliente:', error);
});

// ⚠️ Este evento puede dar error si pupBrowser no existe.
// Podés dejarlo comentado si no lo necesitás.
if (client.pupBrowser?.on) {
  client.pupBrowser.on('disconnected', () => {
    console.log('🧊 Chromium se cerró / murió');
  });
}


// ===================================
//          HANDLER PRINCIPAL
// ===================================

client.on('message', async (msg) => {
  try {
    // Ignorar mensajes propios
    if (msg.fromMe) return;

    // Verificar que el mensaje tiene cuerpo
    if (!msg.body || typeof msg.body !== 'string') {
      console.log('Mensaje sin cuerpo o no es texto, ignorando...');
      return;
    }

    const chat = await msg.getChat();
    const isGroup = chat.isGroup;
    const message = msg.body.trim().toLowerCase();
    const chatId = msg.from;

    console.log(`📩 Mensaje de ${chatId} (${isGroup ? 'Grupo' : 'DM'}): "${msg.body}"`);

    if (isGroup) {
      await handleGroupMessage(msg, chat, message);
    } else {
      await handleDirectMessage(msg, chat, message);
    }
  } catch (err) {
    console.error('❌ Error en el handler principal:', err);
    try {
      await msg.reply('Ups, algo falló 😅. Probá de nuevo.');
    } catch (e) {
      console.error('No se pudo enviar el mensaje de error:', e);
    }
  }
});

// Manejar errores no capturados
process.on('unhandledRejection', (reason, promise) => {
  if (reason?.message && reason.message.includes('SingletonLock')) {
    console.log('🔄 Error de bloqueo, reiniciando en 5 segundos...');
    setTimeout(() => {
      client.destroy().then(() => {
        cleanupLockFiles();
        initializeClient();
      });
    }, 5000);
  } else {
    console.error('❌ Error no manejado:', reason);
  }
});

process.on('uncaughtException', (error) => {
  console.error('❌ Excepción no capturada:', error);
});

// ===================================
//            MÓDULOS DEL BOT
// ===================================

/**
 * @description Maneja los mensajes de grupos.
 */
async function handleGroupMessage(msg, chat, message) {
  if (ALLOWED_GROUP_IDS.length > 0 && !ALLOWED_GROUP_IDS.includes(chat.id._serialized)) {
    return;
  }

  const hasPrefix = message.startsWith('!');
  const isMentioned = msg.mentionedIds && msg.mentionedIds.includes(client.info.wid._serialized);

  if (!hasPrefix && !isMentioned) return;

  const cleanMessage = message.replace(/^!/, '');
  const [cmd, ...args] = cleanMessage.split(/\s+/);
  const argsText = args.join(' ').trim();

  switch (cmd) {
    case 'menu':
    case 'ayuda':
      await sendGroupMenu(msg);
      break;

    case 'clase':
    case 'reprogramar':
    case 'chisme':
      await handleGroupRequest(msg, cmd, argsText);
      break;

    case 'ultimos':
      await sendUltimosPedidos(msg, chat.id._serialized);
      break;

    case 'ping':
      await safeReply(msg, 'pong 🏓');
      break;

    default:
      if (isMentioned) await sendGroupMenu(msg);
      else await safeReply(msg, '🤔 No entendí el comando. Probá con `!menu`.');
      break;
  }
}

async function handleGroupRequest(msg, type, text) {
  const chatId = msg.from;
  const translations = {
    clase: '📚 Pedido de clase',
    reprogramar: '📅 Reprogramación solicitada',
    chisme: '👀 Chisme recibido',
    familia: '👨‍👩‍👧 Mensaje familiar',
  };
  const replyMsgs = {
    clase: 'Un admin lo revisa y confirma por privado ✅',
    reprogramar: 'En breve confirmamos opciones de horario ⏳',
    chisme: 'Lo leo con mate y bizcochitos ☕🥐'
  };

  const pedidoText = `${translations[type]}: "${text || '...'}"`;
  pushPedido(chatId, pedidoText);

  await safeReply(msg, pedidoText);
  await safeReply(msg, replyMsgs[type]);

  await forwardToMe(msg, translations[type]);
}

/**
 * @description Maneja los mensajes directos (DM) con modo mute.
 */
async function handleDirectMessage(msg, chat, message) {
  const chatId = msg.from;

  // Lógica para el número especial
  const isSpecial = await handleSpecialMessage(msg, chatId, message);
  if (isSpecial) return;

  // Estado actual (por defecto, 'idle' silencioso)
  const currentState = userState[chatId] || 'idle';

  // 🔇 Si está muteado, ignorar todo salvo disparadores
  if (currentState === 'muted' && !isTrigger(message)) {
    console.log(`(muted) Ignorando mensaje de ${chatId}: "${msg.body}"`);
    return; // no responde
  }

  const newState = await processUserState(msg, message, currentState);
  userState[chatId] = newState;
  console.log(`Estado actualizado para ${chatId}: ${currentState} -> ${newState}`);
}

async function handleSpecialMessage(msg, chatId, message) {
  if (chatId !== SPECIAL_NUMBER) return false;

  if (message.includes('te extraño')) {
    await safeReply(msg, '🥺 Yo también, mucho mucho mucho ❤️ (más que el choripán de la cancha 🍖)');
    return true;
  }
  if (message.includes('buen dia') || message.includes('buen día')) {
    await safeReply(msg, 'buen día mi amor, ¿cómo estás?');
    return true;
  }
  if (message.includes('te amo')) {
    await safeReply(msg, 'yo más');
    return true;
  }
  if (message.includes('ya casi nos vemos')) {
    await safeReply(msg, '¡ayyyy sííí!');
    return true;
  }
  if (message.includes('donde estas') || message.includes('dónde estás')) {
    await safeReply(msg, 'acá');
    return true;
  }
  if (message.includes('como va') || message.includes('cómo va')) {
    await safeReply(msg, 'maso, porque no estás a mi lado 😢');
    return true;
  }

  return false;
}

/**
 * @description Lógica de estados del menú con modo 'muted' al finalizar.
 */
async function processUserState(msg, message, state) {
  console.log(`Procesando estado: ${state}, mensaje: "${message}"`);

  // Solo mostramos menú si el usuario usa un disparador
  if (isTrigger(message)) {
    await sendMenu(msg);
    return 'menu_principal';
  }

  switch (state) {
    case 'idle':
      // Estado “quieto”: no respondemos nada salvo triggers.
      return 'idle';

    case 'menu_principal':
  switch (message) {
    case '1':
      await safeReply(msg, '📚 ¿Querés *cancelar* o *reprogramar* la clase?');
      return 'clases';

    case '2':
      await safeReply(msg, '👨‍👩‍👧 ¡Qué lindo que me escribas! ¿Cómo estás vos?');
      return 'familia';

    case '3':
      await safeReply(msg, '🍻 Ey amig@! ¿Es *chisme*, *juntarse*, pasó algo, u *otro motivo*?');
      return 'amigos';

    case '4':
      await safeReply(msg, '👀 Obvio que quiero chisme, ¡contalo ya mismo!');
      return 'chisme';

    case '5':
      await safeReply(msg, '📝 Dale, dejá tu mensaje y en breve lo voy a ver y responder 😉');
      return 'otros';

    case '6':
      // Gracioso + silencio
      await safeReply(msg, '🙋‍♂️ *¡Persona al rescate!* Activo modo silencio para no molestar 🧘');
      return 'muted'; // queda muteado hasta que digas "hola/menu/..." (tus triggers)

    default:
      await safeReply(msg, '😅 No entendí… elegí una opción (1 a 6) o escribí *menu*.');
      return 'menu_principal';
  }



    case 'clases':
      if (message.includes('cancelar')) {
        await safeReply(msg, '❌ Ok, ¿qué clase querés cancelar?');
        return 'clases_cancelar';
      }
      if (message.includes('reprogramar')) {
        await safeReply(msg, '📅 Perfecto, ¿qué clase y qué día/hora te viene bien?');
        return 'clases_reprogramar';
      }
      await safeReply(msg, '¿Querés *cancelar* o *reprogramar* la clase?');
      return 'clases';

    case 'clases_cancelar':
      userInfo[msg.from] = { cancelar: msg.body };
      await safeReply(msg, `👌 Cancelación registrada: ${msg.body}`);
      await forwardToMe(msg, 'Clase para cancelar');
      await safeReply(msg, 'Más tarde lo confirmo 😉');
      return 'muted'; // 🔇 quedamos muteados

    case 'clases_reprogramar':
      userInfo[msg.from] = { reprogramar: msg.body };
      await safeReply(msg, `👌 Reprogramación solicitada: ${msg.body}`);
      await forwardToMe(msg, 'Clase para reprogramar');
      await safeReply(msg, 'Después te confirmo si está disponible ⏳');
      return 'muted'; // 🔇

    case 'familia':
      await safeReply(msg, `💖 Gracias por contarme: "${msg.body}"`);
      await safeReply(msg, '¿En qué te puedo ayudar?');
      return 'familia_ayuda';

    case 'familia_ayuda':
      userInfo[msg.from] = { ayuda: msg.body };
      await safeReply(msg, '👌 Perfecto, lo tengo anotado. Pronto te doy una mano 💪');
      await forwardToMe(msg, 'Familia ayuda');
      return 'muted'; // 🔇

    case 'amigos':
      if (message.includes('chisme')) {
        await safeReply(msg, '😏 Ajá… obvio que quiero saber el chisme. ¡Dale, contalo!');
        return 'chisme';
      } else if (message.includes('juntar')) {
        await safeReply(msg, '🎉 Me encanta! ¿Cuándo y dónde?');
        return 'muted'; // 🔇
      } else if (message.includes('pasó') || message.includes('paso')) {
        await safeReply(msg, '😲 Uh, contame qué pasó así me pongo al día.');
        return 'muted'; // 🔇
      } else {
        await safeReply(msg, '👌 Perfecto, dejame el mensaje y lo leo después.');
        return 'muted'; // 🔇
      }

    case 'chisme':
      await safeReply(msg, `🤣 Jajaja, "${msg.body}" anotado para mi dosis de chisme diario.`);
      await forwardToMe(msg, '¡Chisme!');
      await safeReply(msg, 'Lo leo bien después con mate y bizcochitos ☕🥐');
      return 'muted'; // 🔇

    case 'otros':
      userInfo[msg.from] = { otros: msg.body };
      await safeReply(msg, '👌 Gracias por tu mensaje, pronto te respondo.');
      await forwardToMe(msg, 'Otros motivos');
      return 'muted'; // 🔇

    case 'muted':
      // 🔇 En mute, no respondemos salvo trigger (se chequea en handleDirectMessage)
      return 'muted';

    default:
      // Cualquier estado desconocido -> idle silencioso
      return 'idle';
  }
}

async function sendMenu(msg) {
  const menuText =
    '🙋‍♀️ Hola! Soy *el bot de Angie Rochi* 🎉.\n' +
    'Decime, ¿por qué me contactás?\n\n' +
    '1️⃣ Clases\n' +
    '2️⃣ Familia\n' +
    '3️⃣ Amigos\n' +
    '4️⃣ Chisme\n' +
    '5️⃣ Otros\n' +
    '6️⃣ 🙋‍♂️ ¡Quiero hablar con una persona! (salir del bot)';
  await safeReply(msg, menuText);
}


async function sendGroupMenu(msg) {
  const texto =
    '👋 *Soy el bot de Angie Rochi* (modo grupo)\n\n' +
    'Comandos disponibles:\n' +
    '• `!menu` / `!ayuda` – Muestra este menú\n' +
    '• `!clase <detalle>` – Registrar un pedido de clase\n' +
    '• `!reprogramar <detalle>` – Pedir reprogramación\n' +
    '• `!chisme <texto>` – Descargar chisme (con respeto 😇)\n' +
    '• `!ultimos` – Ver últimos 5 pedidos del grupo\n' +
    '• `!ping` – Pong 🏓\n\n' +
    '💡 Tip: también reacciono si me *mencionan*.';
  await safeReply(msg, texto);
}

function pushPedido(groupId, texto) {
  if (!groupState[groupId]) groupState[groupId] = { ultimosPedidos: [] };
  groupState[groupId].ultimosPedidos.unshift({
    texto,
    ts: new Date().toISOString()
  });
  groupState[groupId].ultimosPedidos =
    groupState[groupId].ultimosPedidos.slice(0, 20);
}

async function sendUltimosPedidos(msg, groupId) {
  const items = (groupState[groupId]?.ultimosPedidos || []).slice(0, 5);
  if (items.length === 0) {
    await safeReply(msg, 'Aún no hay pedidos registrados en este grupo.');
    return;
  }
  const listado = items
    .map((it, i) => ` ${i + 1}. ${it.texto}  _(${formatHora(it.ts)})_`)
    .join('\n');
  await safeReply(msg, '📝 *Últimos pedidos del grupo:*\n' + listado);
}

// ===================================
//       INICIALIZACIÓN CONTROLADA
// ===================================

let isInitializing = false;

function initializeClient() {
  if (isInitializing) {
    console.log('⚠️ Ya se está inicializando, omitiendo...');
    return;
  }

  isInitializing = true;
  console.log('Inicializando cliente de WhatsApp...');

  client.initialize().catch(err => {
    console.error('Error al inicializar el cliente:', err.message);
    isInitializing = false;

    setTimeout(() => {
      cleanupLockFiles();
      initializeClient();
    }, 5000);
  });
}

// Iniciar el cliente
initializeClient();
