import { expect } from "chai";

// Self-contained TransactionQueue class copy for unit testing and validation in Hardhat ESM environment
class TransactionQueueTest {
  constructor() {
    this.queue = [];
    this.isProcessing = false;
    this.maxQueueSize = 1000;
    this.maxRetries = 3;
  }

  async enqueue(task) {
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
      this.processNext();
    });
  }

  async processNext() {
    if (this.isProcessing) return;
    if (this.queue.length === 0) return;

    this.isProcessing = true;
    const item = this.queue.shift();

    try {
      const result = await this.executeWithRetry(item);
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    } finally {
      this.isProcessing = false;
      setTimeout(() => this.processNext(), 0);
    }
  }

  async executeWithRetry(item) {
    while (item.retries <= this.maxRetries) {
      try {
        const result = await this.dispatchTransaction(item);
        return result;
      } catch (error) {
        if (item.retries >= this.maxRetries || this.isPermanentError(error)) {
          throw error;
        }
        item.retries++;
        // Small backoff delay for testing
        const backoffDelay = Math.pow(2, item.retries) * 5 + Math.random() * 2;
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }

  isPermanentError(error) {
    const msg = (error.message || String(error)).toLowerCase();
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

  async dispatchTransaction(item) {
    // Overridden by test assertions
    return { success: true };
  }
}

describe("AdSplit Relayer Transaction Queue Load Test", function () {
  let transactionQueue;

  beforeEach(() => {
    transactionQueue = new TransactionQueueTest();
  });

  it("should process 100 concurrent clicks sequentially without nonce conflicts", async function () {
    let activeExecutions = 0;
    let maxConcurrentExecutions = 0;
    const executionOrder = [];

    // Override mock dispatch
    transactionQueue.dispatchTransaction = async function (item) {
      activeExecutions++;
      if (activeExecutions > maxConcurrentExecutions) {
        maxConcurrentExecutions = activeExecutions;
      }

      // Assert that we are executing exactly 1 task at a time
      expect(activeExecutions).to.equal(1);

      // Simulate network / chain dispatch delay
      await new Promise((resolve) => setTimeout(resolve, 2));

      executionOrder.push(item.id);
      activeExecutions--;
      return { txHash: `0xmockhash_${item.id}`, success: true };
    };

    // Dispatch 100 tasks concurrently
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(
        transactionQueue.enqueue({
          id: `task_${i}`,
          walletId: "mock-wallet",
          contractAddress: "0xmockcontract",
          abiFunctionSignature: "recordEngagement"
        })
      );
    }

    const results = await Promise.all(promises);

    // Assert results
    expect(results.length).to.equal(100);
    expect(maxConcurrentExecutions).to.equal(1); // Never exceeded 1 concurrent execution!
    expect(activeExecutions).to.equal(0);
    expect(executionOrder.length).to.equal(100);
    
    // Verify tasks finished in sequential enqueue order (0 to 99)
    for (let i = 0; i < 100; i++) {
      expect(executionOrder[i]).to.equal(`task_${i}`);
    }
  });

  it("should reject transactions with a DoS limit error when queue limit is exceeded", async function () {
    transactionQueue.maxQueueSize = 5;

    // Enqueue 5 slow tasks
    transactionQueue.dispatchTransaction = async () => {
      await new Promise(r => setTimeout(r, 20));
      return { success: true };
    };

    const promises = [];
    for (let i = 0; i < 6; i++) {
      promises.push(
        transactionQueue.enqueue({
          id: `dos_task_${i}`,
          walletId: "mock-wallet",
          contractAddress: "0xmockcontract"
        })
      );
    }

    // The 7th concurrent enqueue should revert immediately due to size limit
    let didThrow = false;
    try {
      await transactionQueue.enqueue({
        id: "dos_task_overflow",
        walletId: "mock-wallet",
        contractAddress: "0xmockcontract"
      });
    } catch (err) {
      expect(err.message).to.equal("Relayer queue is currently full. Please try again later.");
      didThrow = true;
    }
    expect(didThrow).to.be.true;

    await Promise.all(promises);
  });

  it("should retry transient failures up to maxRetries with backoff", async function () {
    let callCount = 0;
    transactionQueue.dispatchTransaction = async () => {
      callCount++;
      if (callCount < 3) {
        throw new Error("Nonce too low / transient failure");
      }
      return { success: true, txHash: "0xsuccess" };
    };

    const result = await transactionQueue.enqueue({
      id: "retry_task",
      walletId: "mock-wallet",
      contractAddress: "0xmockcontract"
    });

    expect(callCount).to.equal(3); // First 2 failed, 3rd succeeded
    expect(result.success).to.be.true;
  });

  it("should not retry permanent errors", async function () {
    let callCount = 0;
    transactionQueue.dispatchTransaction = async () => {
      callCount++;
      throw new Error("Execution reverted: Invalid proof");
    };

    let didThrow = false;
    try {
      await transactionQueue.enqueue({
        id: "revert_task",
        walletId: "mock-wallet",
        contractAddress: "0xmockcontract"
      });
    } catch (err) {
      expect(err.message).to.contain("Invalid proof");
      didThrow = true;
    }
    expect(didThrow).to.be.true;
    expect(callCount).to.equal(1); // Rejected immediately on first try without retrying
  });
});
