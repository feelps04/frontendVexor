import { useState, useEffect } from 'react';

interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
  category: 'mental' | 'risk' | 'setup';
}

export default function PreTradeChecklist() {
  const [items, setItems] = useState<ChecklistItem[]>([
    // Mental (Atomic Habits)
    { id: '1', text: 'Durma bem na noite anterior (7-8h)', checked: false, category: 'mental' },
    { id: '2', text: 'Sem influências externas (notícias, opiniões)', checked: false, category: 'mental' },
    { id: '3', text: 'Estado emocional neutro ou positivo', checked: false, category: 'mental' },
    { id: '4', text: 'Sem pressa ou urgência de resultado', checked: false, category: 'mental' },
    { id: '5', text: 'Aceito que posso perder e está OK', checked: false, category: 'mental' },
    // Risk
    { id: '6', text: 'Stop definido ANTES da entrada', checked: false, category: 'risk' },
    { id: '7', text: 'Tamanho da posição ≤ 2% do capital', checked: false, category: 'risk' },
    { id: '8', text: 'Perda diária atual < 6% do capital', checked: false, category: 'risk' },
    { id: '9', text: 'Risco/Retorno ≥ 1:2 (Stop:Target)', checked: false, category: 'risk' },
    // Setup
    { id: '10', text: 'Setup validado por 2+ indicadores', checked: false, category: 'setup' },
    { id: '11', text: 'Contexto intermarket favorável', checked: false, category: 'setup' },
    { id: '12', text: 'Sem notícias de alto impacto nos próximos 30min', checked: false, category: 'setup' },
  ]);

  const [tiltLevel, setTiltLevel] = useState(0);
  const [capital, setCapital] = useState(10000);
  const [riskPercent, setRiskPercent] = useState(2);
  const [stopDistance, setStopDistance] = useState(1);

  const API = 'http://localhost:3000/api/v1';

  useEffect(() => {
    loadTiltLevel();
  }, []);

  const loadTiltLevel = async () => {
    try {
      const res = await fetch(`${API}/psych/state`);
      const data = await res.json();
      setTiltLevel(data.tiltLevel || 0);
    } catch (e) {
      console.error('Erro ao carregar tilt:', e);
    }
  };

  const toggleItem = (id: string) => {
    setItems(items.map(item => 
      item.id === id ? { ...item, checked: !item.checked } : item
    ));
  };

  const allChecked = items.every(item => item.checked);
  const mentalChecked = items.filter(i => i.category === 'mental').every(i => i.checked);
  const riskChecked = items.filter(i => i.category === 'risk').every(i => i.checked);
  const setupChecked = items.filter(i => i.category === 'setup').every(i => i.checked);

  // Calcular tamanho da posição
  const riskAmount = capital * (riskPercent / 100);
  const positionSize = riskAmount / stopDistance;
  const maxShares = Math.floor(positionSize);

  // Verificar bloqueios
  const blocked = tiltLevel >= 3 || !riskChecked;

  const getCategoryColor = (category: ChecklistItem['category']) => {
    switch (category) {
      case 'mental': return 'border-blue-500';
      case 'risk': return 'border-red-500';
      case 'setup': return 'border-green-500';
    }
  };

  const getCategoryBg = (category: ChecklistItem['category']) => {
    switch (category) {
      case 'mental': return 'bg-blue-900/30';
      case 'risk': return 'bg-red-900/30';
      case 'setup': return 'bg-green-900/30';
    }
  };

  return (
    <div className="min-h-screen bg-gray-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold">✅ Pre-Trade Checklist</h1>
            <p className="text-gray-400 mt-1">Atomic Habits + Risk Management + Setup Validation</p>
          </div>
          <div className={`px-4 py-2 rounded-lg font-bold ${tiltLevel >= 3 ? 'bg-red-600' : tiltLevel >= 2 ? 'bg-yellow-600' : 'bg-green-600'}`}>
            Tilt: Nível {tiltLevel}
          </div>
        </div>

        {/* Status Banner */}
        <div className={`rounded-xl p-4 mb-6 ${allChecked ? 'bg-green-900/50 border border-green-700' : 'bg-gray-800 border border-gray-700'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-3xl">{allChecked ? '✅' : '⏳'}</span>
              <div>
                <div className="font-bold text-lg">
                  {allChecked ? 'CHECKLIST COMPLETO - PRONTO PARA OPERAR' : 'COMPLETE TODOS OS ITENS'}
                </div>
                <div className="text-gray-400 text-sm">
                  {items.filter(i => i.checked).length} de {items.length} itens verificados
                </div>
              </div>
            </div>
            {allChecked && (
              <button className="px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg font-bold text-lg">
                🚀 LIBERAR ENTRADA
              </button>
            )}
          </div>
        </div>

        {/* Blocked Warning */}
        {blocked && (
          <div className="bg-red-900/50 border border-red-700 rounded-xl p-4 mb-6">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🚫</span>
              <div>
                <div className="font-bold text-lg">ENTRADA BLOQUEADA</div>
                <div className="text-red-300 text-sm">
                  {tiltLevel >= 3 && 'Tilt Nível 3+ detectado - Pausar 15 minutos'}
                  {!riskChecked && ' Itens de Risco não verificados'}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Checklist Sections */}
        <div className="space-y-6">
          {/* Mental */}
          <div className={`rounded-xl p-6 border ${getCategoryColor('mental')} ${getCategoryBg('mental')}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                🧠 Mental (Atomic Habits)
              </h2>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${mentalChecked ? 'bg-green-600' : 'bg-gray-700'}`}>
                {items.filter(i => i.category === 'mental' && i.checked).length}/5
              </span>
            </div>
            <div className="space-y-2">
              {items.filter(i => i.category === 'mental').map(item => (
                <label 
                  key={item.id}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                    item.checked ? 'bg-green-900/30' : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleItem(item.id)}
                    className="w-5 h-5 rounded"
                  />
                  <span className={item.checked ? 'line-through text-gray-400' : ''}>
                    {item.text}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Risk */}
          <div className={`rounded-xl p-6 border ${getCategoryColor('risk')} ${getCategoryBg('risk')}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                ⚠️ Risk Management (OBRIGATÓRIO)
              </h2>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${riskChecked ? 'bg-green-600' : 'bg-red-600'}`}>
                {items.filter(i => i.category === 'risk' && i.checked).length}/4
              </span>
            </div>
            <div className="space-y-2">
              {items.filter(i => i.category === 'risk').map(item => (
                <label 
                  key={item.id}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                    item.checked ? 'bg-green-900/30' : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleItem(item.id)}
                    className="w-5 h-5 rounded"
                  />
                  <span className={item.checked ? 'line-through text-gray-400' : ''}>
                    {item.text}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Setup */}
          <div className={`rounded-xl p-6 border ${getCategoryColor('setup')} ${getCategoryBg('setup')}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                📊 Setup Validation
              </h2>
              <span className={`px-3 py-1 rounded-full text-sm font-bold ${setupChecked ? 'bg-green-600' : 'bg-gray-700'}`}>
                {items.filter(i => i.category === 'setup' && i.checked).length}/3
              </span>
            </div>
            <div className="space-y-2">
              {items.filter(i => i.category === 'setup').map(item => (
                <label 
                  key={item.id}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition ${
                    item.checked ? 'bg-green-900/30' : 'bg-gray-800 hover:bg-gray-700'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => toggleItem(item.id)}
                    className="w-5 h-5 rounded"
                  />
                  <span className={item.checked ? 'line-through text-gray-400' : ''}>
                    {item.text}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Position Calculator */}
        <div className="mt-6 bg-gray-800 rounded-xl p-6 border border-gray-700">
          <h3 className="text-lg font-bold mb-4">🧮 Calculadora de Posição (Kelly Criterion)</h3>
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <label className="block text-gray-400 text-sm mb-1">Capital Total</label>
              <input
                type="number"
                value={capital}
                onChange={(e) => setCapital(parseFloat(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Risco por Trade (%)</label>
              <input
                type="number"
                step="0.5"
                value={riskPercent}
                onChange={(e) => setRiskPercent(parseFloat(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-gray-400 text-sm mb-1">Distância do Stop (R$)</label>
              <input
                type="number"
                step="0.1"
                value={stopDistance}
                onChange={(e) => setStopDistance(parseFloat(e.target.value))}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2"
              />
            </div>
            <div className="bg-gray-700 rounded-lg p-3">
              <div className="text-gray-400 text-sm mb-1">Tamanho Máximo</div>
              <div className="text-2xl font-bold text-green-400">{maxShares} ações</div>
              <div className="text-gray-400 text-sm">R$ {riskAmount.toFixed(2)} de risco</div>
            </div>
          </div>
          {riskPercent > 2 && (
            <div className="mt-3 bg-red-900/50 border border-red-700 rounded-lg p-2 text-sm">
              ⚠️ Risco maior que 2% viola o Cadeado de Ferro!
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-6 bg-gradient-to-r from-purple-900/50 to-blue-900/50 rounded-xl p-6 border border-purple-700">
          <h3 className="text-lg font-bold mb-3">📚 Origem: Atomic Habits + Doutrina Vexor</h3>
          <p className="text-gray-300 text-sm">
            Esta checklist combina os princípios de <span className="text-blue-400">James Clear (Atomic Habits)</span> com
            o <span className="text-red-400">Cadeado de Ferro</span> da Doutrina Vexor. Cada item deve ser verificado
            conscientemente antes de qualquer entrada.
          </p>
        </div>
      </div>
    </div>
  );
}
