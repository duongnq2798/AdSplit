import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

export interface QueueItem {
  id: string;
  walletId: string;
  contractAddress: string;
  abiFunctionSignature: string;
  sponsoredArgs: any[];
  apiKey: string;
  entitySecret: string;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  retries: number;
}

class TransactionQueue {
  private queue: QueueItem[] = [];
  private isProcessing = false;
  private maxQueueSize = 1000; // Strict limit to prevent DoS attacks
  private maxRetries = 3;

  /**
   * Enqueues a transaction for sequential execution to avoid nonce collisions.
   * Returns a promise that resolves when the transaction finishes dispatching.
   */
  public async enqueue(task: Omit<QueueItem, 'resolve' | 'reject' | 'retries'>): Promise<any> {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error("Relayer queue is currently full. Please try again later.");
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        ...task,
        resolve,
        reject,
        retries: 0
      });
      // Start processing queue if idle
      this.processNext();
    });
  }

  /**
   * Returns current size of the queue for monitoring/status checks.
   */
  public getQueueSize(): number {
    return this.queue.length;
  }

  private async processNext() {
    if (this.isProcessing) return;
    if (this.queue.length === 0) return;

    this.isProcessing = true;
    const item = this.queue.shift()!;

    try {
      const result = await this.executeWithRetry(item);
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.isProcessing = false;
      // Trigger next task execution asynchronously to avoid stack overflows
      setTimeout(() => this.processNext(), 0);
    }
  }

  private async executeWithRetry(item: QueueItem): Promise<any> {
    while (item.retries <= this.maxRetries) {
      try {
        const result = await this.dispatchTransaction(item);
        return result;
      } catch (error: any) {
        if (item.retries >= this.maxRetries || this.isPermanentError(error)) {
          throw error;
        }
        item.retries++;
        // Exponential backoff with random jitter to prevent thundering herd
        const backoffDelay = Math.pow(2, item.retries) * 100 + Math.random() * 50;
        console.warn(`[Queue] Nonce/relayer conflict detected. Retrying task ${item.id} in ${backoffDelay.toFixed(0)}ms (Retry ${item.retries}/${this.maxRetries}). Error:`, error.message || error);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }

  private isPermanentError(error: any): boolean {
    const msg = (error.message || String(error)).toLowerCase();
    // Reverts, invalid signatures, ZK proof failures, domain check failures are permanent and should not be retried
    if (
      msg.includes("revert") || 
      msg.includes("unauthorized") || 
      msg.includes("invalid proof") || 
      msg.includes("invalid signature") ||
      msg.includes("forbidden")
    ) {
      return true;
    }
    return false;
  }

  private async dispatchTransaction(item: QueueItem): Promise<any> {
    const { walletId, contractAddress, abiFunctionSignature, sponsoredArgs, apiKey, entitySecret } = item;

    // Dispatch using developer controlled wallets SDK if entity secret is configured
    if (entitySecret && apiKey && apiKey !== 'sandbox_key') {
      const walletsClient = initiateDeveloperControlledWalletsClient({
        apiKey,
        entitySecret,
      });

      const response = await walletsClient.createContractExecutionTransaction({
        walletId,
        contractAddress,
        abiFunctionSignature,
        abiParameters: sponsoredArgs.map((arg: any) => {
          const deepMap = (val: any): any => {
            if (Array.isArray(val)) {
              return val.map(deepMap);
            }
            return val.toString();
          };
          return deepMap(arg);
        }),
        fee: {
          type: 'level',
          config: {
            feeLevel: 'MEDIUM',
          },
        },
        idempotencyKey: `idempotency_${item.id}_${item.retries}`,
      });
      return response;
    } else {
      // Circle API Sandbox Fallback
      const baseUrl = 'https://api-sandbox.circle.com/v1';
      const response = await fetch(`${baseUrl}/w3s/developer/transactions/contractExecution`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          walletId,
          contractAddress,
          abiMethod: abiFunctionSignature,
          abiParameters: sponsoredArgs.map((arg: any) => {
            const deepMap = (val: any): any => {
              if (Array.isArray(val)) {
                return val.map(deepMap);
              }
              return val.toString();
            };
            return deepMap(arg);
          }),
          feeLevel: 'MEDIUM',
          sponsorGas: true,
        }),
      });

      const data = await response.json();
      if (!response.ok || data.error) {
        throw new Error(data.error?.message || data.error || JSON.stringify(data));
      }
      return data;
    }
  }
}

export const transactionQueue = new TransactionQueue();
