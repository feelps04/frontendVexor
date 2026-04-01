// Test script for Appwrite authentication
const { Client, Account } = require('appwrite');

const client = new Client()
    .setEndpoint('https://nyc.cloud.appwrite.io/v1')
    .setProject('69c8b51e00004def8eb3');

const account = new Account(client);

async function testAuth() {
    console.log('Testing Appwrite Authentication...');

    // Test 1: Check connection
    try {
        console.log('1. Testing connection...');
        await client.ping();
        console.log('Connection successful');
    } catch (error) {
        console.log('Connection failed:', error.message);
        return;
    }

    // Test 2: Try to register a new user
    const testEmail = `test${Date.now()}@example.com`;
    const testPassword = 'test123456';
    const testName = 'Test User';

    try {
        console.log('2. Testing registration...');
        console.log(`   Email: ${testEmail}`);
        console.log(`   Password: ${testPassword}`);
        console.log(`   Name: ${testName}`);

        const user = await account.create('unique()', testEmail, testPassword, testName);
        console.log('Registration successful');
        console.log(`   User ID: ${user.$id}`);
        console.log(`   Email: ${user.email}`);
        console.log(`   Name: ${user.name}`);

        // Test 3: Try to login with the new user
        console.log('3. Testing login...');
        const session = await account.createEmailSession(testEmail, testPassword);
        console.log('Login successful');
        console.log(`   Session ID: ${session.$id}`);
        console.log(`   User ID: ${session.userId}`);

        // Test 4: Get current user
        console.log('4. Testing getCurrentUser...');
        const currentUser = await account.get();
        console.log('getCurrentUser successful');
        console.log(`   User ID: ${currentUser.$id}`);
        console.log(`   Email: ${currentUser.email}`);
        console.log(`   Name: ${currentUser.name}`);

        // Test 5: Logout
        console.log('5. Testing logout...');
        await account.deleteSession('current');
        console.log('Logout successful');

    } catch (error) {
        console.log('Test failed:', error.message);
        console.log('   Code:', error.code);
        console.log('   Type:', error.type);

        // If user already exists, try to login
        if (error.code === 409) {
            console.log('User already exists, attempting login...');
            try {
                const session = await account.createEmailSession(testEmail, testPassword);
                console.log('Login successful');
                console.log(`   Session ID: ${session.$id}`);
                console.log(`   User ID: ${session.userId}`);
            } catch (loginError) {
                console.log('Login failed:', loginError.message);
            }
        }
    }

    console.log('Test completed');
}

testAuth().catch(console.error);