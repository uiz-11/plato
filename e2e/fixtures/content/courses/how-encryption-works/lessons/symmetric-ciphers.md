# Locks with one key

Encryption turns a readable message, the *plaintext*, into scrambled *ciphertext* that only someone holding the right key can turn back. For most of history every cipher worked the same basic way: the sender and the receiver shared one secret, and that secret both locked and unlocked the message. :cite[src-shannon]

## One key for both directions

::anchor{#a-one-key}

A cipher that uses the same key to encrypt and to decrypt is called *symmetric*. Today's workhorse is AES, the Advanced Encryption Standard, which NIST published in 2001 and which protects everything from Wi-Fi traffic to the files on your phone. :cite[src-fips-197]

The oldest symmetric ciphers were simple. A Caesar cipher shifts every letter of the alphabet by the same number of places, so with a shift of three, A becomes D and B becomes E. The shift is the key. Because there are only 26 letters, there are only 25 useful shifts, and anyone can try them all in a minute with pencil and paper. :general[Caesar ciphers are trivially breakable by trying every shift.]

::guess{#g-caesar}

Modern ciphers work on bits rather than letters. The simplest bit-level operation used in ciphers is exclusive or, written $\oplus$. It compares two bits and outputs 1 when they differ and 0 when they match. Its useful property is that applying the same key twice gets you back where you started, as the identity below shows. :cite[src-shannon]

$$
(m \oplus k) \oplus k = m
$$

For example, with the message $m = 1011$ and the key $k = 0110$, the ciphertext is $1101$. XOR the ciphertext with the same key again and $1011$ comes back. :general[This identity follows directly from the definition of exclusive or.]

Here is the same idea in a few lines of Python. :general[Real ciphers are far more elaborate, but the shape is the same: one key goes in on both sides.]

```python
def xor_bytes(data: bytes, key: bytes) -> bytes:
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))

secret = xor_bytes(b"meet at noon", b"k3y")
assert xor_bytes(secret, b"k3y") == b"meet at noon"
```

Repeating a short key like this is weak, because patterns in the message leak through. Shannon showed in 1949 that XOR is perfectly secure only when the key is truly random, as long as the message, and never reused: the scheme known as the one-time pad. :cite[src-shannon]

:::analogy{#padlock}
Think of a symmetric key as a key to a padlocked box. You lock the box, post it, and your friend opens it with an identical copy of the key. Anyone who intercepts the box sees only the lock.
:::

## The method is not the secret

::anchor{#a-kerckhoffs}

It is tempting to think a cipher is safer if nobody knows how it works. Cryptographers learned the opposite. In the nineteenth century Auguste Kerckhoffs argued that a system must stay secure even if the enemy knows everything about it except the key. Shannon later put the same idea in five words: :cite[src-shannon]

> "The enemy knows the system." :cite[src-shannon]

There are three reasons this principle won. :general[These are the standard arguments for open cryptographic design.]

- A secret algorithm is studied only by the few people who built it, while a public one is attacked by thousands of experts, so its weaknesses surface early. :cite[src-fips-197]
- Secrets leak. Software can be taken apart, and staff change jobs. A design that falls apart once it is known gives no lasting protection. :general[Reverse engineering of software is routine.]
- If a key leaks, you make a new one in a second. If a secret algorithm leaks, every device that uses it must be replaced. :general[Changing a key is cheap; changing an algorithm is not.]

That is why AES was chosen through an open public competition, with every candidate published for anyone to attack. :cite[src-fips-197]

::misconception{#m-secret-algorithm}

## Why longer keys matter

::anchor{#a-key-length}

If the algorithm is public, an attacker can always try every possible key until one produces sensible plaintext. This *brute-force* attack is the yardstick for every cipher. :cite[src-shannon]

A key of $n$ bits has $2^n$ possible values, so each extra bit doubles the attacker's work. A 10-bit key has $2^{10} = 1024$ values, which a computer tries in an instant. AES keys are 128, 192 or 256 bits long. :cite[src-fips-197]

| Key length | Possible keys |
|---|---|
| 10 bits | about a thousand |
| 56 bits | about 72 quadrillion |
| 128 bits | about $3.4 \times 10^{38}$ |

The 56-bit row is the old Data Encryption Standard, which special-purpose hardware broke by brute force in the late 1990s. A 128-bit key is only a little over twice as long as a 56-bit one, yet it has $2^{72}$ times as many keys, far more than any realistic amount of computing could ever search. :general[These figures follow from the arithmetic of powers of two.]

::guess{#g-open-design}

Key length is only a floor. A cipher with a long key can still be broken by a clever shortcut that avoids trying every key, which is exactly what years of public study try to rule out. :cite[src-shannon]

## The catch

Symmetric ciphers are fast and, with a good algorithm and a long random key, extremely strong. But both sides need the same key before they can talk. If you have never met the person you want to write to, how do you get them the key without someone copying it along the way? This is the *key distribution problem*, and for centuries the only answers were couriers and codebooks. :cite[src-diffie-hellman]

Even with a shared key, encryption hides a message but does not prove it arrived unchanged. For that, cryptographers use a different tool: a fingerprint for data, which the next lesson covers. :general[Encryption and integrity checking are separate goals.]
