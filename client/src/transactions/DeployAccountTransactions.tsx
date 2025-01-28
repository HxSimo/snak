import { InvokeTransaction } from '@/types/starknetagents';
import { WalletAccount } from 'starknet';

export const handleDeployTransactions = async (
  Wallet: WalletAccount,
  Tx: InvokeTransaction,
  public_key: string,
  private_key: string,
  contractaddress: string
): Promise<string> => {
  try {
    if (!public_key || !private_key || !contractaddress) {
      throw new Error('Invalid Credidentials');
    }
    const deploy_input = `Deploy Argent Account ${public_key} ${private_key} ${contractaddress}`;
    const fund_account_tx = await Wallet.execute(Tx);
    if (!fund_account_tx) {
      throw new Error(
        'The Transfer for fund the new account fail check your balance'
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 20000)); // Need to improve this

    const deploy_tx = await fetch('/api/wallet/call_data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.NEXT_PUBLIC_API_KEY || '',
      },
      body: JSON.stringify({ request: deploy_input }),
      credentials: 'include',
    });
    const tx_result = await deploy_tx.json();
    const response: string =
      tx_result.status === 'failure'
        ? tx_result.status
        : `Your accout has been succesfully deploy at ${tx_result.contract_address} transaction_hash : ${tx_result.transaction_hash}, Creditentials : ${private_key}`;
    console.log(response);
    return response;
  } catch (error) {
    return error as string;
  }
};
