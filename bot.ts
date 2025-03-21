// npm install socket.io-client typescript ts-node @types/node
// npx ts-node bot.ts

const { io } = require('socket.io-client');

const MAX_ROUND = 20;
class TrustPVPClient {
  private socket: any;
  private playerName: string;
  private playerId: string | null = null;
  private isInGame: boolean = false;
  // 添加对手历史记录跟踪
  private opponentHistory: Map<string, Array<string>> = new Map();
  // 添加当前对手ID跟踪
  private currentOpponentId: string = '';
  private currentOpponentName: string = '';
  // 添加回合计数器
  private roundCounter: Map<string, number> = new Map();
  private maxRounds: number = MAX_ROUND;
  private currentScore: number = 20;

  constructor(serverUrl: string, playerName: string) {
    this.playerName = playerName;

    // 根据API文档配置Socket连接
    this.socket = io(serverUrl, {
      transports: ['websocket'], // 强制使用WebSocket
      upgrade: false, // 禁止协议升级
      reconnectionAttempts: 5, // 重连次数
      timeout: 10000 // 连接超时时间
    });

    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // 基础连接事件
    this.socket.on('connect', () => {
      console.log('已连接到服务器');
      this.login();
    });

    this.socket.on('connect_error', (error: Error) => {
      console.error('连接错误:', error);
    });

    this.socket.on('disconnect', (reason: string) => {
      console.log('断开连接，原因:', reason);
      this.isInGame = false;
    });

    // 重连相关事件
    this.socket.on('reconnect_attempt', (attempt: number) => {
      console.log(`尝试重连 (${attempt})`);
    });

    this.socket.on('reconnect', () => {
      console.log('重连成功');
      if (this.playerId) {
        this.login();
      }
    });

    // 游戏相关事件
    this.socket.on('loginSuccess', (data: { playerData: any, isNewPlayer: boolean }) => {
      console.log('登录成功', data.isNewPlayer ? '(新玩家)' : '(老玩家)');
      this.playerId = data.playerData.id;
      this.joinGame();
    });

    this.socket.on('gameJoined', (data: { playerData: any, globalRewards: any }) => {
      console.log('成功加入游戏');
      console.log('全局奖励机制:', data.globalRewards);
      this.isInGame = true;

      // 初始化回合计数器为1，为新游戏做准备
      if (this.currentOpponentId) {
        this.roundCounter.set(this.currentOpponentId, 1);
        console.log(`新游戏开始，重置回合计数器为1`);
      }
    });

    this.socket.on('matchFound', (data: { opponent: string, opponentName: string, opponentHistory: any[], currentRewards: any[] }) => {
      console.log(`匹配到对手: ${data.opponentName} (ID: ${data.opponent})`);

      // 保存当前对手ID和名称
      this.currentOpponentId = data.opponent;
      this.currentOpponentName = data.opponentName;
      // 根据对手历史行为决定策略
      const choice = this.decideStrategy(data.opponentHistory, data.currentRewards);
      this.makeChoice(choice);

    });

    this.socket.on('roundComplete', (data: {
      score: number,
      totalScore: number,
      opponentChoice: string,
      opponentName: string,
      opponent?: string // 添加对手ID参数，如果API返回的数据中包含
    }) => {
      this.currentScore = data.score;
      console.log(`回合结束 - 得分: ${data.score}, 总分: ${data.totalScore}`);
      console.log(`对手 ${data.opponentName} 选择了: ${data.opponentChoice === 'cooperate' ? '合作' : '背叛'}`);

      // 使用API返回的对手ID或保存的当前对手ID
      const opponentId = data.opponent || this.currentOpponentId;

      if (opponentId) {
        this.recordOpponentChoice(opponentId, data.opponentChoice);
        console.log(`已记录对手选择: ID=${opponentId}, 选择=${data.opponentChoice}`);

        // 增加回合计数
        const currentRound = this.roundCounter.get(opponentId) || 1;
        this.roundCounter.set(opponentId, currentRound + 1);
        console.log(`当前完成第 ${currentRound} 回合，下一回合将是第 ${currentRound + 1} 回合`);
      } else {
        console.warn('无法记录对手选择：缺少对手ID');
      }

      // 短暂延迟后加入下一局游戏
      setTimeout(() => {
        if (this.socket.connected) {
          this.joinGame();
        }
      }, 1000);
    });

    this.socket.on('gameEnd', (data: {
      finalScore: number,
      history: any[],
      rounds: number,
      message: string
    }) => {
      console.log('游戏结束:', data.message);
      console.log(`最终得分: ${data.finalScore}, 总回合数: ${data.rounds}`);
      this.isInGame = false;

      // 短暂延迟后重新加入游戏
      setTimeout(() => {
        if (this.socket.connected) {
          this.joinGame();
        }
      }, 2000);
    });

    this.socket.on('opponentDisconnected', (data: { message: string }) => {
      console.log('对手断开连接:', data.message);
      this.isInGame = false;

      // 短暂延迟后重新加入游戏
      setTimeout(() => {
        if (this.socket.connected) {
          this.joinGame();
        }
      }, 1000);
    });

    this.socket.on('error', (data: { message: string }) => {
      console.error('错误:', data.message);
    });
  }

  private login(): void {
    const loginData = this.playerId
      ? { playerName: this.playerName, playerId: this.playerId }
      : { playerName: this.playerName };

    this.socket.emit('login', loginData);
  }

  public joinGame(): void {
    if (!this.isInGame) {
      console.log('尝试加入游戏...');
      this.socket.emit('joinGame');
    }
  }

  // 记录对手选择的历史
  private recordOpponentChoice(opponentId: string, choice: string): void {
    if (!this.opponentHistory.has(opponentId)) {
      this.opponentHistory.set(opponentId, []);
    }

    const history = this.opponentHistory.get(opponentId);
    if (history) {
      history.push(choice);
      console.log(`对手历史记录更新 - ID: ${opponentId}, 历史: [${history.join(', ')}]`);
      // 只保留最近的20次选择，防止历史记录过长
      if (history.length > 20) {
        history.shift();
      }
    }
  }


  // 根据对手历史行为和奖励记录，进行策略选择
  private decideStrategy(history: any[], rewards: any[]): "cooperate" | "betray" {


    // 对手历史行为压缩分类
    const historyClassify = this.historyClassify(history);

    // 对手奖励记录压缩分类
    const rewardsClassify = this.rewardsClassify(rewards);

    // 对手行为预测
    const behaviorPrediction = this.behaviorPrediction(historyClassify, rewardsClassify);

    // 根据对手行为预测，进行策略选择。
    const strategy = this.strategySelection(behaviorPrediction, this.currentScore);

    return strategy;
  }
  private strategySelection(behaviorPrediction: number, currentScore: number): "cooperate" | "betray" {
    throw new Error("Method not implemented.");
    return "cooperate";
  }
  private behaviorPrediction(historyClassify: [number, number], rewardsClassify: number): number {
    throw new Error("Method not implemented.");
    return 0;
  }
  private rewardsClassify(rewards: any[]): number {
    throw new Error("Method not implemented.");
    return 0;
  }
  private historyClassify(history: any[]): [number, number] {
    throw new Error("Method not implemented.");
    return [0, 0];
  }

  private makeChoice(choice: 'cooperate' | 'betray'): void {
    console.log(`选择: ${choice === 'cooperate' ? '合作' : '背叛'}`);
    this.socket.emit('makeChoice', choice);

    // 注意：这里不需要增加回合计数，因为回合计数在roundComplete事件中已经处理
  }

  public getLeaderboard(): void {
    this.socket.emit('getLeaderboard');
    this.socket.once('leaderboardData', (data: { leaderboard: any }) => {
      console.log('排行榜数据:', data.leaderboard);
    });
  }

  public getPlayerStats(): void {
    this.socket.emit('getPlayerStats');
    this.socket.once('playerStats', (data: { stats: any }) => {
      console.log('玩家统计数据:', data.stats);
    });
  }

  public disconnect(): void {
    this.socket.disconnect();
  }
}

// 使用示例
// const serverUrl = 'http://localhost:3000'; // 替换为实际服务器地址
const serverUrl = 'http://118.123.202.87:13001'; // 替换为实际服务器地址
const playerName = 'duan bot 2'; // 替换为你想要的玩家名称

const client = new TrustPVPClient(serverUrl, playerName);

// 处理程序退出
process.on('SIGINT', () => {
  console.log('正在断开连接并退出...');
  client.disconnect();
  process.exit(0);
});

console.log('智能策略客户端已启动，按 Ctrl+C 退出');