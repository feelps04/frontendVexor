export interface TransactionData {
  id: string;
  accountId: string;
  symbol: string;
  type: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: Date;
  status: 'pending' | 'completed' | 'failed';
}

export class Transaction implements TransactionData {
  id: string;
  accountId: string;
  symbol: string;
  type: 'buy' | 'sell';
  quantity: number;
  price: number;
  timestamp: Date;
  status: 'pending' | 'completed' | 'failed';

  constructor(data: TransactionData) {
    this.id = data.id;
    this.accountId = data.accountId;
    this.symbol = data.symbol;
    this.type = data.type;
    this.quantity = data.quantity;
    this.price = data.price;
    this.timestamp = data.timestamp;
    this.status = data.status;
  }

  toJSON(): TransactionData {
    return {
      id: this.id,
      accountId: this.accountId,
      symbol: this.symbol,
      type: this.type,
      quantity: this.quantity,
      price: this.price,
      timestamp: this.timestamp,
      status: this.status,
    };
  }

  static fromJSON(data: TransactionData): Transaction {
    return new Transaction(data);
  }
}

export interface CoreConfig {
  environment: string;
  debug: boolean;
}

export class Core {
  constructor(config: CoreConfig) {
    this.config = config;
  }

  private config: CoreConfig;

  getConfig(): CoreConfig {
    return this.config;
  }
}
