// Shop: avatars, pets, throwables, power-ups. Buy + equip.
import { api } from '../api.js';
import { $, store, fmt, onShow, toast, setProfile, ensureCatalog } from '../app.js';
import { sfx } from '../sound.js';
import { esc } from './lobby.js';

let category = 'avatars';

export function initShop() {
  onShow('shop', async () => {
    if (!store.catalog) {
      $('#shop-grid').innerHTML = '<div class="empty-note"><span class="spin">🂠</span> Loading the shop…</div>';
      await ensureCatalog();
    }
    render();
  });
  document.querySelectorAll('#shop-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#shop-tabs .tab').forEach(t => t.classList.toggle('active', t === tab));
      category = tab.dataset.cat;
      render();
    });
  });
}

function dealInfo(itemId) {
  const deals = store.catalog?.deals;
  if (!deals || !deals.items.includes(itemId)) return null;
  return deals.discount;
}

// Price shown (and charged) honors today's deals.
function priceOf(item) {
  const d = dealInfo(item.id);
  return d ? Math.floor(item.price * (1 - d)) : item.price;
}

function render() {
  const grid = $('#shop-grid');
  const cat = store.catalog;
  const p = store.profile;
  if (!cat || !p) { grid.innerHTML = ''; return; }
  $('#shop-coins').textContent = fmt(p.coins);
  const inv = p.inventory || {};

  let html = '';

  // Daily deals strip (shows on every tab; hides items already owned)
  const deals = cat.deals;
  if (deals && deals.items.length) {
    const dealCards = deals.items
      .map(id => {
        const item = findCatalogItem(cat, id);
        if (!item || (inv[id] || 0) > 0) return '';
        return `<div class="shop-item deal-item">
          <span class="deal-tag">-${Math.round(deals.discount * 100)}%</span>
          <span class="item-emoji">${item.emoji}</span>
          <span class="item-name">${esc(item.name)}</span>
          <span class="item-price"><s>${fmt(item.price)}</s> 🪙 ${fmt(priceOf(item))}</span>
          ${buyBtn(item.id, priceOf(item), p.coins)}
        </div>`;
      }).join('');
    if (dealCards) {
      html += `<div class="deals-strip"><h3>🔥 Today's Deals</h3><div class="deals-row">${dealCards}</div></div>`;
    }
  }
  if (category === 'avatars') {
    html += cat.avatars.free.map(a => card({
      emoji: a, name: 'Starter', desc: 'Free for everyone',
      action: p.avatar === a ? equippedBtn() : `<button class="btn btn-ghost" data-equip-avatar="${a}">Equip</button>`,
    })).join('');
    html += Object.values(cat.avatars.premium).map(item => {
      const owned = (inv[item.id] || 0) > 0;
      return card({
        emoji: item.emoji, name: item.name, desc: item.exclusive ? `${item.exclusive} exclusive` : 'Premium avatar',
        price: owned || item.exclusive ? null : priceOf(item),
        action: owned
          ? (p.avatar === item.emoji ? equippedBtn() : `<button class="btn btn-ghost" data-equip-avatar="${item.emoji}">Equip</button>`)
          : item.exclusive ? exclusiveTag() : buyBtn(item.id, priceOf(item), p.coins),
      });
    }).join('');
    // Avatar frames — animated rings everyone sees around your avatar.
    html += card({
      emoji: '⭕', name: 'No Frame', desc: 'Plain avatar',
      action: !p.frame ? equippedBtn() : '<button class="btn btn-ghost" data-equip-frame="">Unequip</button>',
    });
    html += Object.values(cat.frames || {}).map(item => {
      const owned = (inv[item.id] || 0) > 0;
      return card({
        emojiHtml: `<span class="frame-preview ${item.id}">${p.avatar}</span>`,
        name: item.name, desc: item.exclusive ? `${item.exclusive} exclusive` : 'Avatar frame',
        price: owned || item.exclusive ? null : priceOf(item),
        action: owned
          ? (p.frame === item.id ? equippedBtn() : `<button class="btn btn-ghost" data-equip-frame="${item.id}">Equip</button>`)
          : item.exclusive ? exclusiveTag(item.exclusive) : buyBtn(item.id, priceOf(item), p.coins),
      });
    }).join('');
  } else if (category === 'pets') {
    html += card({
      emoji: '🚫', name: 'No pet', desc: 'Play without a companion',
      action: !p.pet ? equippedBtn() : '<button class="btn btn-ghost" data-equip-pet="">Unequip</button>',
    });
    html += Object.values(cat.pets).map(item => {
      const owned = (inv[item.id] || 0) > 0;
      return card({
        emoji: item.emoji, name: item.name, desc: item.exclusive ? `${item.exclusive} exclusive` : 'Sits at the table with you',
        price: owned || item.exclusive ? null : priceOf(item),
        action: owned
          ? (p.pet === item.id ? equippedBtn() : `<button class="btn btn-ghost" data-equip-pet="${item.id}">Equip</button>`)
          : item.exclusive ? exclusiveTag() : buyBtn(item.id, priceOf(item), p.coins),
      });
    }).join('');
  } else if (category === 'throwables') {
    html += Object.values(cat.throwables).map(item => card({
      emoji: item.emoji, name: item.name,
      desc: item.kind === 'gift' ? 'A friendly gift' : item.kind === 'burst' ? 'Party in a bag' : 'Splat! Right in the face',
      price: priceOf(item), priceNote: `pack of ${item.pack}`,
      owned: inv[item.id] ? `${inv[item.id]} owned` : '',
      action: buyBtn(item.id, priceOf(item), p.coins),
    })).join('');
  } else if (category === 'celebrations') {
    html += card({
      emoji: '🎉', name: 'Classic', desc: 'The standard tiered celebration',
      action: !p.celebration ? equippedBtn() : '<button class="btn btn-ghost" data-equip-celebration="">Equip</button>',
    });
    html += Object.values(cat.celebrations || {}).map(item => {
      const owned = (inv[item.id] || 0) > 0;
      return card({
        emoji: item.emoji, name: item.name, desc: item.desc,
        price: owned ? null : priceOf(item),
        action: owned
          ? (p.celebration === item.id ? equippedBtn() : `<button class="btn btn-ghost" data-equip-celebration="${item.id}">Equip</button>`)
          : buyBtn(item.id, priceOf(item), p.coins),
      });
    }).join('');
  } else if (category === 'tablefx') {
    html += card({
      emoji: '🟢', name: 'Classic Felt', desc: 'The original green',
      action: !p.tableTheme ? equippedBtn() : '<button class="btn btn-ghost" data-equip-theme="">Equip</button>',
    });
    html += Object.values(cat.themes || {}).map(item => {
      const owned = (inv[item.id] || 0) > 0;
      return card({
        emoji: item.emoji, name: item.name, desc: 'Table felt theme',
        price: owned ? null : priceOf(item),
        action: owned
          ? (p.tableTheme === item.id ? equippedBtn() : `<button class="btn btn-ghost" data-equip-theme="${item.id}">Equip</button>`)
          : buyBtn(item.id, priceOf(item), p.coins),
      });
    }).join('');
    html += card({
      emoji: '🟦', name: 'Classic Back', desc: 'The original blue card back',
      action: !p.cardBack ? equippedBtn() : '<button class="btn btn-ghost" data-equip-back="">Equip</button>',
    });
    html += Object.values(cat.cardbacks || {}).map(item => {
      const owned = (inv[item.id] || 0) > 0;
      return card({
        emoji: item.emoji, name: item.name, desc: item.exclusive ? `${item.exclusive} exclusive` : 'Card back design',
        price: owned || item.exclusive ? null : priceOf(item),
        action: owned
          ? (p.cardBack === item.id ? equippedBtn() : `<button class="btn btn-ghost" data-equip-back="${item.id}">Equip</button>`)
          : item.exclusive ? exclusiveTag() : buyBtn(item.id, priceOf(item), p.coins),
      });
    }).join('');
    html += card({
      emoji: '🔔', name: 'Classic Sounds', desc: 'The original bleeps',
      action: !p.soundPack ? equippedBtn() : '<button class="btn btn-ghost" data-equip-sound="">Equip</button>',
    });
    html += Object.values(cat.soundpacks || {}).map(item => {
      const owned = (inv[item.id] || 0) > 0;
      return card({
        emoji: item.emoji, name: item.name, desc: 'Sound pack',
        price: owned ? null : priceOf(item),
        action: owned
          ? (p.soundPack === item.id ? equippedBtn() : `<button class="btn btn-ghost" data-equip-sound="${item.id}">Equip</button>`)
          : buyBtn(item.id, priceOf(item), p.coins),
      });
    }).join('');
  } else if (category === 'powerups') {
    html += Object.values(cat.powerups).map(item => {
      const held = inv[item.id] || 0;
      return card({
        emoji: item.emoji, name: item.name, desc: item.desc,
        rarity: item.rarity,
        price: item.buyable ? item.price : null,
        priceNote: item.buyable ? `max ${item.maxHeld}` : 'free deal only',
        owned: held ? `${held} owned` : '',
        action: item.buyable ? buyBtn(item.id, priceOf(item), p.coins, held >= item.maxHeld) : '<span class="rarity legendary">Lucky deal only</span>',
      });
    }).join('');
  }
  grid.innerHTML = html;

  grid.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const res = await api.post('/api/shop/buy', { itemId: b.dataset.buy });
      setProfile(res.profile);
      sfx.coin();
      toast('Purchased! 🎉', 'gold');
    } catch (err) {
      toast(err.message, 'error');
      sfx.error();
    }
    render();
  }));
  grid.querySelectorAll('[data-equip-avatar]').forEach(b => b.addEventListener('click', () => equip({ avatar: b.dataset.equipAvatar })));
  grid.querySelectorAll('[data-equip-frame]').forEach(b => b.addEventListener('click', () => equip({ frame: b.dataset.equipFrame || null })));
  grid.querySelectorAll('[data-equip-pet]').forEach(b => b.addEventListener('click', () => equip({ pet: b.dataset.equipPet || null })));
  grid.querySelectorAll('[data-equip-celebration]').forEach(b => b.addEventListener('click', () => equip({ celebration: b.dataset.equipCelebration || null })));
  grid.querySelectorAll('[data-equip-theme]').forEach(b => b.addEventListener('click', () => equip({ tableTheme: b.dataset.equipTheme || null })));
  grid.querySelectorAll('[data-equip-back]').forEach(b => b.addEventListener('click', () => equip({ cardBack: b.dataset.equipBack || null })));
  grid.querySelectorAll('[data-equip-sound]').forEach(b => b.addEventListener('click', async () => {
    await equip({ soundPack: b.dataset.equipSound || null });
    sfx.win(); // preview the new voice right away
  }));
}

async function equip(body) {
  try {
    const res = await api.post('/api/profile/equip', body);
    setProfile(res.profile);
    sfx.gift();
    render();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function card({ emoji, emojiHtml, name, desc, price, priceNote, owned, rarity, action }) {
  return `<div class="shop-item">
    ${rarity ? `<span class="rarity ${rarity}">${rarity}</span>` : ''}
    <span class="item-emoji">${emojiHtml || emoji}</span>
    <span class="item-name">${esc(name)}</span>
    <span class="item-desc">${esc(desc || '')}</span>
    ${price != null ? `<span class="item-price">🪙 ${fmt(price)}${priceNote ? ` <small>· ${priceNote}</small>` : ''}</span>` : (priceNote ? `<span class="item-desc">${priceNote}</span>` : '')}
    ${owned ? `<span class="owned-count">✓ ${owned}</span>` : ''}
    ${action || ''}
  </div>`;
}

function buyBtn(id, price, coins, maxed = false) {
  return `<button class="btn btn-primary" data-buy="${id}" ${coins < price || maxed ? 'disabled' : ''}>${maxed ? 'Max held' : 'Buy'}</button>`;
}

function findCatalogItem(cat, id) {
  return cat.avatars.premium[id] || cat.pets[id] || cat.celebrations?.[id]
    || cat.themes?.[id] || cat.cardbacks?.[id] || cat.soundpacks?.[id]
    || cat.frames?.[id] || cat.throwables[id] || null;
}

function equippedBtn() {
  return '<button class="btn btn-success" disabled>Equipped ✓</button>';
}

function exclusiveTag(label = 'Battle Pass') {
  return `<span class="badge gold">🎫 ${esc(label)}</span>`;
}
