"""
VEXOR RAG Pipeline - Retrieval-Augmented Generation
OCI Bucket → Oracle NoSQL → Llama 3.3
27 Livros da Doutrina Vexor embedados
"""

import oci
import json
import hashlib
import numpy as np
from typing import List, Dict, Optional, Tuple
from sentence_transformers import SentenceTransformer
import requests

# ==================== CONFIGURAÇÃO ====================

CONFIG = {
    # OCI
    'oci_config_path': '~/.oci/config',
    'bucket_namespace': 'vexor',
    'bucket_name': 'vexor-trading',
    
    # Oracle NoSQL
    'nosql_table': 'vexor_knowledge',
    
    # Embedding
    'embedding_model': 'all-MiniLM-L6-v2',
    'chunk_size': 512,
    'chunk_overlap': 64,
    
    # Ollama
    'ollama_host': 'http://localhost:11434',
    'ollama_model': 'llama3.2:latest',  # Usando modelo disponível
    
    # RAG
    'top_k': 5,
    'min_similarity': 0.3
}

# Metadados dos 27 livros
BOOKS_META = {
    "trading_in_the_zone": {"author": "Mark Douglas", "category": "psicologia", "priority": 10},
    "o_trader_disciplinado": {"author": "Mark Douglas", "category": "psicologia", "priority": 10},
    "antifragil": {"author": "Nassim Taleb", "category": "risco", "priority": 9},
    "rapido_e_devagar": {"author": "Daniel Kahneman", "category": "psicologia", "priority": 9},
    "mental_game_of_trading": {"author": "Jared Tendler", "category": "psicologia", "priority": 9},
    "atomic_habits": {"author": "James Clear", "category": "habitos", "priority": 8},
    "meditations": {"author": "Marcus Aurelius", "category": "filosofia", "priority": 8},
    "daily_trading_coach": {"author": "Brett Steenbarger", "category": "coach", "priority": 8},
    "quantitative_trading": {"author": "Howard Bandy", "category": "quant", "priority": 7},
    "intermarket_analysis": {"author": "John Murphy", "category": "correlacao", "priority": 7},
    "mind_over_markets": {"author": "Dalton", "category": "market_profile", "priority": 7},
    "japanese_candlestick": {"author": "Steve Nison", "category": "tecnica", "priority": 7},
    "tape_reading": {"author": "Vadym Graifer", "category": "fluxo", "priority": 6},
    "bollinger_on_bands": {"author": "John Bollinger", "category": "tecnica", "priority": 6},
    "price_action_trends": {"author": "Al Brooks", "category": "tecnica", "priority": 6},
    "skin_in_the_game": {"author": "Nassim Taleb", "category": "etica", "priority": 6},
    "mindset": {"author": "Carol Dweck", "category": "psicologia", "priority": 7},
    "flow": {"author": "Csikszentmihalyi", "category": "performance", "priority": 7},
    "encyclopedia_chart_patterns": {"author": "Thomas Bulkowski", "category": "tecnica", "priority": 6},
    "high_probability_trading": {"author": "Marcel Link", "category": "tecnica", "priority": 6},
    "mastering_the_trade": {"author": "John Carter", "category": "tecnica", "priority": 6},
    "man_who_solved_market": {"author": "Jim Simons", "category": "quant", "priority": 6},
    "trading_as_business": {"author": "Charlie Wright", "category": "gestao", "priority": 5},
    "pai_rico_pai_pobre": {"author": "Robert Kiyosaki", "category": "financas", "priority": 5},
    "technical_analysis_markets": {"author": "John Murphy", "category": "tecnica", "priority": 7},
    "atitude_mental_trader": {"author": "Mark Douglas", "category": "psicologia", "priority": 10},
    "cisne_negro": {"author": "Nassim Taleb", "category": "risco", "priority": 9}
}

# ==================== EMBEDDING MODEL ====================

class EmbeddingModel:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.model = SentenceTransformer(CONFIG['embedding_model'])
        return cls._instance
    
    def encode(self, texts: List[str]) -> np.ndarray:
        return self.model.encode(texts, batch_size=32, show_progress_bar=False)
    
    def encode_single(self, text: str) -> np.ndarray:
        return self.model.encode([text])[0]

# ==================== TEXT CHUNKER ====================

def chunk_text(text: str, chunk_size: int = 512, overlap: int = 64) -> List[str]:
    """Divide texto em chunks com overlap"""
    words = text.split()
    chunks = []
    i = 0
    
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    
    return chunks

# ==================== OCI BUCKET READER ====================

class OCIBucketReader:
    def __init__(self):
        self.config = oci.config.from_file(CONFIG['oci_config_path'])
        self.client = oci.object_storage.ObjectStorageClient(self.config)
        self.namespace = CONFIG['bucket_namespace']
        self.bucket = CONFIG['bucket_name']
    
    def list_books(self) -> List[str]:
        """Lista todos os livros no bucket"""
        objects = self.client.list_objects(self.namespace, self.bucket)
        return [obj.name for obj in objects.data.objects 
                if obj.name.endswith(('.txt', '.pdf', '.md'))]
    
    def get_book(self, object_name: str) -> str:
        """Baixa conteúdo do livro"""
        resp = self.client.get_object(self.namespace, self.bucket, object_name)
        return resp.data.content.decode('utf-8', errors='ignore')

# ==================== ORACLE NOSQL VECTOR STORE ====================

class NoSQLVectorStore:
    """
    Armazena vetores + metadata no Oracle NoSQL
    Simula busca vetorial com cosine similarity
    """
    
    def __init__(self):
        self.vectors: Dict[str, Dict] = {}  # Em memória por ora
        # TODO: Conectar ao Oracle NoSQL real via borneo SDK
    
    def insert(self, chunk_id: str, embedding: np.ndarray, 
               metadata: Dict, text: str) -> None:
        """Insere chunk com embedding"""
        self.vectors[chunk_id] = {
            'id': chunk_id,
            'embedding': embedding.tolist(),
            'metadata': metadata,
            'text': text
        }
    
    def search(self, query_embedding: np.ndarray, top_k: int = 5,
               category_filter: Optional[str] = None) -> List[Dict]:
        """Busca por similaridade de cosseno"""
        results = []
        query_vec = query_embedding / np.linalg.norm(query_embedding)
        
        for chunk_id, data in self.vectors.items():
            # Filtra por categoria
            if category_filter and data['metadata'].get('category') != category_filter:
                continue
            
            # Calcula similaridade
            chunk_vec = np.array(data['embedding'])
            chunk_vec = chunk_vec / np.linalg.norm(chunk_vec)
            similarity = np.dot(query_vec, chunk_vec)
            
            if similarity >= CONFIG['min_similarity']:
                results.append({
                    'id': chunk_id,
                    'text': data['text'],
                    'author': data['metadata'].get('author', 'Unknown'),
                    'book': data['metadata'].get('book', 'Unknown'),
                    'category': data['metadata'].get('category', 'geral'),
                    'priority': data['metadata'].get('priority', 5),
                    'similarity': float(similarity)
                })
        
        # Ordena por similaridade
        results.sort(key=lambda x: x['similarity'], reverse=True)
        return results[:top_k]
    
    def count(self) -> int:
        return len(self.vectors)

# ==================== RAG PIPELINE ====================

class RAGPipeline:
    def __init__(self):
        self.embedder = EmbeddingModel()
        self.bucket_reader = OCIBucketReader()
        self.vector_store = NoSQLVectorStore()
        self._initialized = False
    
    async def initialize(self) -> int:
        """Inicializa pipeline - ingere livros do bucket"""
        if self._initialized:
            return self.vector_store.count()
        
        print("[RAG] Inicializando pipeline...")
        
        # Lista livros no bucket
        books = self.bucket_reader.list_books()
        print(f"[RAG] Encontrados {len(books)} livros no OCI Bucket")
        
        total_chunks = 0
        for book_name in books:
            try:
                # Baixa livro
                text = self.bucket_reader.get_book(book_name)
                
                # Chunking
                chunks = chunk_text(text, CONFIG['chunk_size'], CONFIG['chunk_overlap'])
                
                # Embeddings
                embeddings = self.embedder.encode(chunks)
                
                # Metadados
                book_key = book_name.replace('.txt', '').replace('.pdf', '').replace('.md', '')
                meta = BOOKS_META.get(book_key, {'author': 'Unknown', 'category': 'geral', 'priority': 5})
                
                # Insere no vector store
                for idx, (chunk, emb) in enumerate(zip(chunks, embeddings)):
                    chunk_id = f"{book_key}:{idx}"
                    self.vector_store.insert(
                        chunk_id, emb,
                        {**meta, 'book': book_key, 'chunk_idx': idx},
                        chunk
                    )
                
                total_chunks += len(chunks)
                print(f"[RAG] {book_name}: {len(chunks)} chunks")
                
            except Exception as e:
                print(f"[RAG] Erro ao processar {book_name}: {e}")
        
        self._initialized = True
        print(f"[RAG] Total: {total_chunks} chunks embedados")
        return total_chunks
    
    async def retrieve(self, query: str, top_k: int = 5,
                       category_filter: Optional[str] = None) -> str:
        """Recupera contexto relevante do NoSQL"""
        if not self._initialized:
            await self.initialize()
        
        # Embedda query
        query_embedding = self.embedder.encode_single(query)
        
        # Busca no vector store
        results = self.vector_store.search(query_embedding, top_k, category_filter)
        
        if not results:
            return "Nenhum contexto relevante encontrado na base de conhecimento."
        
        # Formata contexto
        context_parts = []
        for r in results:
            context_parts.append(
                f"[{r['author']} — {r['book']} (sim: {r['similarity']:.2f})]\n{r['text']}"
            )
        
        return "\n\n---\n\n".join(context_parts)
    
    async def query_with_rag(self, query: str, 
                             system_prompt: str,
                             trade_context: Optional[Dict] = None,
                             category_filter: Optional[str] = None) -> str:
        """Query completa com RAG"""
        
        # 1. Recupera contexto RAG
        rag_context = await self.retrieve(query, CONFIG['top_k'], category_filter)
        
        # 2. Formata contexto do dia
        daily_state = ""
        if trade_context:
            daily_state = f"""
=== ESTADO DO DIA ===
P&L: R$ {trade_context.get('daily_pnl', 0):.2f}
Trades: {trade_context.get('trades', 0)}/10
Win Rate: {trade_context.get('win_rate', 0.5) * 100:.1f}%
Drawdown: {trade_context.get('drawdown', 0) * 100:.1f}%
"""
        
        # 3. Monta prompt completo
        full_prompt = f"""
=== CONHECIMENTO RELEVANTE (Oracle NoSQL RAG) ===
{rag_context}

{daily_state}

=== PERGUNTA ===
{query}
"""
        
        # 4. Chama Ollama
        try:
            response = requests.post(
                f"{CONFIG['ollama_host']}/api/chat",
                json={
                    "model": CONFIG['ollama_model'],
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": full_prompt}
                    ],
                    "stream": False,
                    "options": {
                        "temperature": 0.2,
                        "num_predict": 300
                    }
                },
                timeout=30
            )
            
            if response.ok:
                return response.json()['message']['content']
            else:
                return f"Erro Ollama: {response.status_code}"
                
        except Exception as e:
            return f"Erro ao conectar Ollama: {e}"
    
    def get_stats(self) -> Dict:
        """Estatísticas do RAG"""
        return {
            'total_chunks': self.vector_store.count(),
            'books_loaded': len(set(
                v['metadata'].get('book') 
                for v in self.vector_store.vectors.values()
            )),
            'initialized': self._initialized
        }

# ==================== SINGLETON ====================

rag_pipeline = RAGPipeline()

# ==================== EXPORT ====================

__all__ = ['rag_pipeline', 'RAGPipeline', 'EmbeddingModel', 'NoSQLVectorStore', 'BOOKS_META']
