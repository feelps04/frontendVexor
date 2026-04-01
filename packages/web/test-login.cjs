// Test script for Appwrite login with specific credentials
const { Client, Account } = require('appwrite');

const client = new Client()
    .setEndpoint('https://nyc.cloud.appwrite.io/v1')
    .setProject('69ca2d3500241cd99f27');

const account = new Account(client);

async function testLogin() {
    console.log('Testing Appwrite Login with specific credentials...');

    // Test 1: Check connection
    try {
        console.log('1. Testing connection...');
        await client.ping();
        console.log('Connection successful');
    } catch (error) {
        console.log('Connection failed:', error.message);
        return;
    }

    // Test 2: Try to login with the provided credentials
    const email = 'warp03409@gmail.com';
    const password = 'L26112004L';

    try {
        console.log('2. Testing login...');
        console.log(`   Email: ${email}`);
        console.log(`   Password: ${password}`);

        const session = await account.createEmailPasswordSession(email, password);
        console.log('Login successful');
        console.log(`   Session ID: ${session.$id}`);
        console.log(`   User ID: ${session.userId}`);

        // Test 3: Get current user
        console.log('3. Testing getCurrentUser...');
        const currentUser = await account.get();
        console.log('getCurrentUser successful');
        console.log(`   User ID: ${currentUser.$id}`);
        console.log(`   Email: ${currentUser.email}`);
        console.log(`   Name: ${currentUser.name}`);

        // Test 4: Logout
        console.log('4. Testing logout...');
        await account.deleteSession('current');
        console.log('Logout successful');

    } catch (error) {
        console.log('Login failed:', error.message);
        console.log('   Code:', error.code);
        console.log('   Type:', error.type);
    }

    console.log('Test completed');
}

testLogin().catch(console.error);