import { Client, Account } from 'appwrite'

export const PROJECT_ID = 'standard_cc70a22dbdab1f144654b3f7d8c5ff99b22609ef70c3962af0807bd8be8a41136565ec2edcd37f4f093eca63c05bb735a3d36e67a38cae4cd938f75e5387cf9669208c1262b80597398693d52ad3c225e8c55f1a4f1e615ef037766b7d6489abc831b483b33a9833c592f6cdec4f0453281ee57aebf36f1dc1d1c9142bc6cf44'
export const ENDPOINT = 'https://nyc.cloud.appwrite.io/v1'

const client = new Client()
  .setEndpoint(ENDPOINT)
  .setProject(PROJECT_ID)

export const account = new Account(client)

export async function loginAppwrite(email: string, password: string) {
  const session = await account.createEmailSession(email, password)
  const user = await account.get()
  return { session, user }
}

export async function registerAppwrite(email: string, password: string, name: string) {
  await account.create('unique()', email, password, name)
  const session = await account.createEmailSession(email, password)
  const user = await account.get()
  return { session, user }
}

export async function logoutAppwrite() {
  try {
    await account.deleteSession('current')
  } catch (e) {}
}

export async function getCurrentUser() {
  try {
    return await account.get()
  } catch {
    return null
  }
}
