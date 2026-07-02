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

function render() {
  const grid = $('#shop-grid');
  const cat = store.catalog;
  const p = store.profile;
  if (!cat || !p) { grid.innerHTML = ''; return; }
  $('#shop-coins').textContent = fmt(p.coins);
  const inv = p.inventory || {};

  let html = '';
  if (category === 'avatars') {
    html += cat.avatars.free.map(a => card({
      emoji: a, name: 'Starter', desc: 'Free for everyone',
      action: p.avatar === a ? equippedBtn() : `<button class="btn btn-ghost" data-equip-avatar="${a}">Equip</button>`,
    })).join('');
    html += Object.values(cat.avatars.premium).map(item => {
      const owned = (inv[item.id] || 0) > 0;
      return card({
        emoji: item.emoji, name: item.name, desc: 'Premium avatar',
        price: owned ? null : item.price,
        action: owned
          ? (p.avatar === item.emoji ? equippedBtn() : `<button class="btn btn-ghost" data-equip-avatar="${item.emoji}">Equip</button>`)
          : buyBtn(item.id, item.price, p.coins),
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
        emoji: item.emoji, name: item.name, desc: 'Sits at the table with you',
        price: owned ? null : item.price,
        action: owned
          ? (p.pet === item.id ? equippedBtn() : `<button class="btn btn-ghost" data-equip-pet="${item.id}">Equip</button>`)
          : buyBtn(item.id, item.price, p.coins),
      });
    }).join('');
  } else if (category === 'throwables') {
    html += Object.values(cat.throwables).map(item => card({
      emoji: item.emoji, name: item.name,
      desc: item.kind === 'gift' ? 'A friendly gift' : item.kind === 'burst' ? 'Party in a bag' : 'Splat! Right in the face',
      price: item.price, priceNote: `pack of ${item.pack}`,
      owned: inv[item.id] ? `${inv[item.id]} owned` : '',
      action: buyBtn(item.id, item.price, p.coins),
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
        price: owned ? null : item.price,
        action: owned
          ? (p.celebration === item.id ? equippedBtn() : `<button class="btn btn-ghost" data-equip-celebration="${item.id}">Equip</button>`)
          : buyBtn(item.id, item.price, p.coins),
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
        action: item.buyable ? buyBtn(item.id, item.price, p.coins, held >= item.maxHeld) : '<span class="rarity legendary">Lucky deal only</span>',
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
  grid.querySelectorAll('[data-equip-pet]').forEach(b => b.addEventListener('click', () => equip({ pet: b.dataset.equipPet || null })));
  grid.querySelectorAll('[data-equip-celebration]').forEach(b => b.addEventListener('click', () => equip({ celebration: b.dataset.equipCelebration || null })));
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

function card({ emoji, name, desc, price, priceNote, owned, rarity, action }) {
  return `<div class="shop-item">
    ${rarity ? `<span class="rarity ${rarity}">${rarity}</span>` : ''}
    <span class="item-emoji">${emoji}</span>
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

function equippedBtn() {
  return '<button class="btn btn-success" disabled>Equipped ✓</button>';
}
