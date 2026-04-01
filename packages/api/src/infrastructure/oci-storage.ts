/**
 * OCI Object Storage + Ollama Strategy Generator
 * Carrega livros do bucket e gera estratégias com IA
 */

import * as https from 'https';
import * as crypto from 'crypto';
import * as fs from 'fs';

const NAMESPACE = process.env.OCI_OBJECT_STORAGE_NAMESPACE || 'vexor';
const BUCKET_NAME = process.env.OCI_BUCKET_NAME || 'vexor-trading';
const REGION = process.env.OCI_REGION || 'sa-saopaulo-1';
const TENANCY_OCID = process.env.OCI_TENANCY_OCID || '';
const USER_OCID = process.env.OCI_USER_OCID || '';
const FINGERPRINT = process.env.OCI_FINGERPRINT || '';
const PRIVATE_KEY_PATH = process.env.OCI_PRIVATE_KEY_PATH || '';
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'localhost';
const OLLAMA_PORT = process.env.OLLAMA_PORT || '11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2:latest';

export interface StrategyBook {
  name: string;
  content: string;
  strategies: Array<{
    name: string;
    genes: Array<{ name: string; value: number; min: number; max: number; mutationRate: number }>;
    generation: number;
    profitFactor: number;
    winRate: number;
  }>;
}

function getPrivateKey(): string {
  try {
    if (PRIVATE_KEY_PATH && fs.existsSync(PRIVATE_KEY_PATH)) {
      return fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
    }
    return '';
  } catch {
    return '';
  }
}

function signString(stringToSign: string, privateKey: string): string {
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(stringToSign);
  return sign.sign(privateKey, 'base64');
}

function makeOCIRequest(method: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const date = new Date().toUTCString();
    const host = `objectstorage.${REGION}.oraclecloud.com`;
    const privateKey = getPrivateKey();
    
    const headers: Record<string, string> = {
      'date': date,
      'host': host,
      'content-type': 'application/json'
    };
    
    if (privateKey) {
      const signingString = `date: ${date}\n(request-target): ${method.toLowerCase()} ${path}\nhost: ${host}`;
      const signature = signString(signingString, privateKey);
      headers['authorization'] = `keyId="${TENANCY_OCID}/${USER_OCID}/${FINGERPRINT}",algorithm="rsa-sha256",headers="date (request-target) host",signature="${signature}"`;
    }
    
    const options = {
      hostname: host,
      port: 443,
      path: path,
      method: method,
      headers: headers
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function callOllama(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: prompt,
      stream: false
    });
    
    const options = {
      hostname: OLLAMA_HOST,
      port: parseInt(OLLAMA_PORT),
      path: '/api/generate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.response || '');
        } catch {
          resolve('');
        }
      });
    });
    
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Lista objetos no bucket
 */
export async function listObjects(prefix?: string): Promise<string[]> {
  try {
    const path = `/n/${NAMESPACE}/b/${BUCKET_NAME}/o${prefix ? `?prefix=${prefix}` : ''}`;
    const data = await makeOCIRequest('GET', path);
    const json = JSON.parse(data);
    return json.objects?.map((o: { name: string }) => o.name) || [];
  } catch (error) {
    console.error('[OCI Storage] Erro ao listar objetos:', error);
    return [];
  }
}

/**
 * Baixa um objeto do bucket
 */
export async function getObject(objectName: string): Promise<string | null> {
  try {
    const path = `/n/${NAMESPACE}/b/${BUCKET_NAME}/o/${encodeURIComponent(objectName)}`;
    return await makeOCIRequest('GET', path);
  } catch (error) {
    console.error(`[OCI Storage] Erro ao baixar ${objectName}:`, error);
    return null;
  }
}

/**
 * Carrega livros de estratégias do bucket e gera com Ollama
 */
export async function loadStrategyBooks(): Promise<StrategyBook[]> {
  try {
    console.log('[OCI Storage] 📚 Carregando livros do bucket...');
    const objects = await listObjects('strategies/');
    const books: StrategyBook[] = [];
    
    for (const obj of objects) {
      if (obj.endsWith('.json') || obj.endsWith('.txt') || obj.endsWith('.md')) {
        const content = await getObject(obj);
        if (content) {
          try {
            // Se for JSON, parseia diretamente
            if (obj.endsWith('.json')) {
              const book = JSON.parse(content) as StrategyBook;
              books.push(book);
              console.log(`[OCI Storage] � Livro carregado: ${obj}`);
            } else {
              // Se for texto, usa Ollama para gerar estratégias
              console.log(`[OCI Storage] 🤖 Gerando estratégias com Ollama: ${obj}`);
              const strategies = await generateStrategiesFromBook(content, obj);
              books.push({
                name: obj.replace('strategies/', '').replace(/\.[^.]+$/, ''),
                content: content,
                strategies: strategies
              });
            }
          } catch (e) {
            console.error(`[OCI Storage] Erro ao processar ${obj}:`, e);
          }
        }
      }
    }
    
    return books;
  } catch (error) {
    console.error('[OCI Storage] Erro ao carregar livros:', error);
    return [];
  }
}

/**
 * Gera estratégias usando Ollama baseado no conteúdo do livro
 */
async function generateStrategiesFromBook(bookContent: string, bookName: string): Promise<StrategyBook['strategies']> {
  const prompt = `Baseado no seguinte livro de trading, gere 3 estratégias de trading com parâmetros otimizados:

LIVRO:
${bookContent.substring(0, 3000)}

Responda APENAS com um JSON válido no formato:
[
  {
    "name": "NomeDaEstrategia",
    "genes": [
      {"name": "stopPercent", "value": 2, "min": 0.5, "max": 5, "mutationRate": 0.2},
      {"name": "targetMultiplier", "value": 2, "min": 1.5, "max": 5, "mutationRate": 0.2},
      {"name": "volumeThreshold", "value": 1.5, "min": 1.2, "max": 3, "mutationRate": 0.15},
      {"name": "rsiOversold", "value": 30, "min": 20, "max": 40, "mutationRate": 0.1},
      {"name": "rsiOverbought", "value": 70, "min": 60, "max": 80, "mutationRate": 0.1}
    ],
    "generation": 1,
    "profitFactor": 1.5,
    "winRate": 0.6
  }
]`;

  try {
    const response = await callOllama(prompt);
    // Extrair JSON da resposta
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return [];
  } catch (error) {
    console.error(`[Ollama] Erro ao gerar estratégias para ${bookName}:`, error);
    return [];
  }
}

import * as http from 'http';

export const ociStorage = {
  listObjects,
  getObject,
  loadStrategyBooks
};
