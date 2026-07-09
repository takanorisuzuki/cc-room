import { generateRoomSecret, generateId, generateNonce } from "@cc-room/shared";

export function createFixtures() {
  return {
    roomId: generateId(),
    roomSecret: generateRoomSecret(),
    nonce: generateNonce(),
    identityA: "test-akira",
    identityB: "test-yuki",
    wsPortA: 17331,
    wsPortB: 17332,
    httpPortA: 17333,
    httpPortB: 17334,
  };
}
