import {
  SupervisorAgent,
  SupervisorAgentConfig,
} from './supervisor/supervisorAgent.js';
import { RpcProvider } from 'starknet';
import { logger, AgentConfig, ModelsConfig } from '@snakagent/core';
import { AgentMode } from '../config/agentConfig.js';
import { Postgres } from '@snakagent/database';
export interface Conversation {
  conversation_name: string;
}

export interface Message {
  agent_id: string;
  sender_type: string;
  content: string;
  status: string;
}

export interface ConversationResponse {
  conversation_id: number;
  conversation_name: string;
}

export interface OutputResponse {
  index: number;
  type: string;
  text: string;
}
export interface Response {
  output: Message;
  input: Message;
}

export interface ErrorResponse {
  statusCode: number;
  name: string;
  errorCode: string;
  errorMessage: string;
}

export interface ServerState {
  index: number;
  type: string;
  status: string;
  text: string;
}
/**
 * Configuration for the agent system initialization
 */
export interface AgentSystemConfig {
  starknetProvider: RpcProvider;
  accountPrivateKey: string;
  accountPublicKey: string;
  modelsConfig: ModelsConfig;
  agentMode: AgentMode;
  databaseCredentials: any;
  agentConfigPath?: AgentConfig;
  debug?: boolean;
}

/**
 * Main class for initializing and managing the agent system
 */
export class AgentSystem {
  private supervisorAgent: SupervisorAgent | null = null;
  private config: AgentSystemConfig;
  private agentConfig: AgentConfig;

  constructor(config: AgentSystemConfig) {
    this.config = config;
    logger.info('Initializing Agent System');
  }

  /**
   * Initializes the agent system.
   * This involves loading the agent configuration (if provided) and setting up the supervisor agent.
   */
  public async init(): Promise<void> {
    try {
      // Load agent configuration if path is provided
      if (this.config.agentConfigPath) {
        logger.debug(
          `AgentSystem: Loading agent configuration from: ${this.config.agentConfigPath}`
        );
        try {
          if (typeof this.config.agentConfigPath === 'string') {
            this.agentConfig = await this.loadAgentConfig(
              this.config.agentConfigPath
            );
          } else {
            this.agentConfig = this.config.agentConfigPath;
          }
        } catch (loadError) {
          logger.error(
            `AgentSystem: Failed to load agent configuration: ${loadError}`
          );
          // Continue without agentConfig if loading fails
        }
      } else {
        logger.warn(
          'AgentSystem: No agentConfigPath provided, proceeding without agent-specific configuration.'
        );
      }

      if (!this.agentConfig) {
        throw new Error('Agent configuration is required');
      }

      // Create the config object for SupervisorAgent
      const supervisorConfigObject: SupervisorAgentConfig = {
        modelsConfig: this.config.modelsConfig,
        debug: this.config.debug,
        starknetConfig: {
          provider: this.config.starknetProvider,
          accountPrivateKey: this.config.accountPrivateKey,
          accountPublicKey: this.config.accountPublicKey,
          agentConfig: this.agentConfig,
          db_credentials: this.config.databaseCredentials,
        },
      };

      // Initialize the supervisor agent
      this.supervisorAgent = new SupervisorAgent(supervisorConfigObject);

      // Initialize the supervisor, which will initialize all other agents
      await this.supervisorAgent.init();

      logger.info('AgentSystem: Initialization complete');
    } catch (error) {
      logger.error(`AgentSystem: Initialization failed: ${error}`);
      throw new Error(`Failed to initialize agent system: ${error}`);
    }
  }

  /**
   * Loads agent configuration from the specified file path.
   * @param configPath The path to the agent configuration file.
   * @returns A promise that resolves with the parsed AgentConfig.
   * @throws Will throw an error if the configuration file cannot be read or parsed.
   */
  private async loadAgentConfig(configPath: string): Promise<AgentConfig> {
    try {
      const fs = await import('fs/promises');
      const configContent = await fs.readFile(configPath, 'utf-8');
      return JSON.parse(configContent);
    } catch (error) {
      logger.error(
        `Failed to load agent configuration from ${configPath}: ${error}`
      );
      throw new Error(`Failed to load agent configuration: ${error}`);
    }
  }

  private async insert_message_into_db(message: Message): Promise<number> {
    try {
      logger.debug('Inserting message into DB:', message);
      const message_q = new Postgres.Query(
        `
        INSERT INTO message (agent_id, sender_type, content) VALUES ($1, $2, $3) RETURNING id`,
        [message.agent_id, message.sender_type, message.content]
      );
      const message_q_res = await Postgres.query<number>(message_q);
      logger.debug(`Messagfe inserted into DB: ${message_q_res[0]}`);
      return message_q_res[0];
    } catch (error) {
      logger.error(error);
      throw error;
    }
  }

  /**
   * Executes a command using the agent system.
   * @param input The input string for the command.
   * @param config Optional configuration for the execution.
   * @returns A promise that resolves with the execution result.
   * @throws Will throw an error if the agent system is not initialized or if execution fails.
   */
  public async execute(
    message: Message | string,
    config?: Record<string, any>
  ): Promise<any> {
    if (!this.supervisorAgent) {
      throw new Error('Agent system not initialized. Call init() first.');
    }

    try {
      // TODO : make start send a message type instead of string
      Postgres.connect(this.config.databaseCredentials);
      const content = typeof message === 'string' ? message : message.content;
      const response = await this.supervisorAgent.execute(
        content,
        config
      );
      logger.debug(JSON.stringify(response));
      if (typeof message === 'string') {
        logger.info('The request has not been saved in the database');
        return response;
      }
      else {
        logger.info("The request has been saved in the database")
        await this.insert_message_into_db(message);
        const r_msg: Message = {
          agent_id: message.agent_id,
          sender_type: 'ai',
          content: response,
          status: 'success',
        };
        await this.insert_message_into_db(r_msg);
      }
      
      return response;
    } catch (error) {
      logger.error(`AgentSystem: Execution error: ${error}`);
      throw error;
    }
  }

  /**
   * Retrieves the supervisor agent instance.
   * @returns The SupervisorAgent instance, or null if not initialized.
   */
  public getSupervisor(): SupervisorAgent | null {
    return this.supervisorAgent;
  }

  /**
   * Retrieves the Starknet agent (main agent).
   * @returns The Starknet agent instance.
   * @throws Will throw an error if the agent system is not initialized.
   */
  public getStarknetAgent(): any {
    if (!this.supervisorAgent) {
      throw new Error('Agent system not initialized. Call init() first.');
    }
    return this.supervisorAgent.getStarknetAgent();
  }

  /**
   * Retrieves an operator by its ID.
   * @param id The ID of the operator to retrieve.
   * @returns The operator instance.
   * @throws Will throw an error if the agent system is not initialized.
   */
  public getOperator(id: string): any {
    if (!this.supervisorAgent) {
      throw new Error('Agent system not initialized. Call init() first.');
    }
    return this.supervisorAgent.getOperator(id);
  }

  /**
   * Releases resources used by the agent system.
   * Sets the supervisor agent to null.
   */
  public async dispose(): Promise<void> {
    logger.debug('AgentSystem: Disposing resources');
    this.supervisorAgent = null;
    logger.info('AgentSystem: Resources disposed');
  }

  /**
   * Starts a hybrid execution flow.
   * @param initialInput The initial input to begin the autonomous execution.
   * @returns A promise that resolves with the initial state and a thread ID for further interaction.
   * @throws Will throw an error if the agent system is not initialized.
   */
  public async startHybridExecution(
    initialInput: string
  ): Promise<{ state: any; threadId: string }> {
    if (!this.supervisorAgent) {
      throw new Error('Agent system not initialized. Call init() first.');
    }

    return await this.supervisorAgent.startHybridExecution(initialInput);
  }

  /**
   * Provides input to a paused hybrid execution.
   * @param input The human input to provide to the execution.
   * @param threadId The thread ID of the paused execution.
   * @returns A promise that resolves with the updated state of the execution.
   * @throws Will throw an error if the agent system is not initialized.
   */
  public async provideHybridInput(
    input: string,
    threadId: string
  ): Promise<any> {
    if (!this.supervisorAgent) {
      throw new Error('Agent system not initialized. Call init() first.');
    }

    return await this.supervisorAgent.provideHybridInput(input, threadId);
  }

  /**
   * Checks if a hybrid execution is currently waiting for user input.
   * @param state The current execution state.
   * @returns True if the execution is waiting for input, false otherwise.
   * @throws Will throw an error if the agent system is not initialized.
   */
  public isWaitingForInput(state: any): boolean {
    if (!this.supervisorAgent) {
      throw new Error('Agent system not initialized. Call init() first.');
    }

    return this.supervisorAgent.isWaitingForInput(state);
  }

  /**
   * Checks if a hybrid execution has completed.
   * @param state The current execution state.
   * @returns True if the execution is complete, false otherwise.
   * @throws Will throw an error if the agent system is not initialized.
   */
  public isExecutionComplete(state: any): boolean {
    if (!this.supervisorAgent) {
      throw new Error('Agent system not initialized. Call init() first.');
    }

    return this.supervisorAgent.isExecutionComplete(state);
  }
}

/**
 * Helper function to create and initialize an instance of the AgentSystem.
 * @param config The configuration for the agent system.
 * @returns A promise that resolves with the initialized AgentSystem instance.
 */
export async function createAgentSystem(
  config: AgentSystemConfig
): Promise<AgentSystem> {
  const system = new AgentSystem(config);
  await system.init();
  return system;
}
