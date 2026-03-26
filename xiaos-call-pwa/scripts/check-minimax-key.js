/**
 * 檢查 .env 中的 MINIMAX_API_KEY 是否有效
 * 使用方式：在 mazu-call-pwa 目錄執行 node scripts/check-minimax-key.js
 */

import 'dotenv/config';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// 從專案根目錄載入 .env（與 server.js 一致）
import { config } from 'dotenv';
config({ path: join(root, '.env') });

const KEY = process.env.MINIMAX_API_KEY || '';
const GROUP_ID = process.env.MINIMAX_GROUP_ID || '';

async function check() {
  console.log('檢查 MINIMAX_API_KEY 健康狀態...\n');

  if (!KEY) {
    console.log('❌ 未設定 MINIMAX_API_KEY');
    console.log('   請在 .env 中設定 MINIMAX_API_KEY=（勿使用 .env.example）');
    process.exit(1);
  }

  const keyPreview = KEY.length > 12 ? KEY.slice(0, 8) + '...' + KEY.slice(-4) : '***';
  console.log('Key 前後綴:', keyPreview);

  const url = 'https://api.minimax.io/v1/get_voice';
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${KEY}`,
  };
  if (GROUP_ID) headers['Group-Id'] = GROUP_ID;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ voice_type: 'system' }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.status === 401) {
      console.log('❌ KEY 無效或已過期（401 Unauthorized）');
      if (data.base_resp?.status_msg) console.log('   訊息:', data.base_resp.status_msg);
      process.exit(1);
    }

    if (res.status !== 200) {
      console.log('❌ 請求失敗 HTTP', res.status);
      if (data.base_resp) console.log('   訊息:', data.base_resp.status_msg || data);
      process.exit(1);
    }

    const code = data.base_resp?.status_code;
    const msg = data.base_resp?.status_msg || '';

    if (code === 0) {
      const n = (data.system_voice || []).length;
      console.log('✅ KEY 有效，健康狀態正常');
      console.log('   系統音色數量:', n);
      if (msg) console.log('   狀態:', msg);
    } else {
      console.log('❌ API 回傳異常 status_code:', code);
      console.log('   訊息:', msg);
      process.exit(1);
    }
  } catch (err) {
    console.log('❌ 連線或請求錯誤:', err.message);
    process.exit(1);
  }
}

check();
