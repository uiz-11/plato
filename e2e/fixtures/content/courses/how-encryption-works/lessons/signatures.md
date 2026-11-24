# Proving who sent it

Diffie–Hellman lets two parties agree on a key, but not know who they agreed it with. In 1978 Ron Rivest, Adi Shamir and Leonard Adleman published RSA, a system in which each person has two keys, and which made digital signatures practical. :cite[src-rsa]

## Two keys instead of one

::anchor{#a-key-pairs}

In public-key cryptography each person generates a *key pair*. The *public key* can be published anywhere, on a website or in a directory. The *private key* never leaves its owner. What one key does, only the other can check or undo. :cite[src-rsa]

In RSA the public key includes a large number $n = p \times q$, the product of two secret primes. Multiplying two primes hundreds of digits long is quick; factoring their product back into $p$ and $q$ is, as far as anyone knows, infeasible on ordinary computers. Anyone who could factor $n$ could rebuild the private key. :cite[src-rsa]

So a key pair gives two different powers. Anyone can use your public key to encrypt a message that only you can read. And only you, holding the private key, can produce something that everyone can check with your public key. That second power is a signature. :cite[src-rsa]

::guess{#g-sign-key}

## Signing and checking

::anchor{#a-signing}

To sign a document, software first hashes it, then applies the signer's private key to the hash. The result is the signature, attached to the document. :cite[src-rsa]

To check it, anyone applies the signer's public key to the signature and compares the result with their own hash of the document. A match proves two things at once: :cite[src-rsa]

- the signature was made with the matching private key, so it came from whoever holds it; :cite[src-rsa]
- the document has not changed since it was signed, because any change would change its hash. :cite[src-fips-180]

This is why hash collisions matter. If an attacker can make two documents with the same hash, a signature on one is also a valid signature on the other. :cite[src-shattered]

::misconception{#m-sign-secret}

## How a website proves who it is

When you visit your bank, its server sends your browser a *certificate*: the bank's public key and domain name, signed by a certificate authority. Your browser ships with a built-in list of authorities it trusts, so it can check that signature itself. :cite[src-rfc-8446]

In TLS 1.3 the server then signs the handshake, including its Diffie–Hellman value, with the private key that matches the certificate. Now the gap from the last lesson is closed: an attacker in the middle cannot forge that signature, so your browser knows the key exchange really was with the bank. :cite[src-rfc-8446]

The padlock in your address bar means exactly this chain of checks succeeded. It does not mean the site is honest or bug-free, only that you are talking privately to the holder of that domain's certificate. :general[Browser padlocks indicate a valid TLS connection, not trustworthiness.]

## The quantum question

::anchor{#a-quantum}

A large enough quantum computer could factor numbers and solve discrete logarithms efficiently, using a method known as Shor's algorithm. That would break RSA and Diffie–Hellman alike, along with their elliptic-curve versions. :cite[src-nist-pqc]

Symmetric ciphers and hashes fare much better. :general[The best known quantum attack on them roughly halves their effective key length, so AES with 256-bit keys is still considered safe.]

::guess{#g-quantum}

No quantum computer today comes anywhere near the size needed. :uncertain[Estimates of when one might exist range from about a decade to never.] The risk is real now anyway, because an attacker can record encrypted traffic today and decrypt it once such a machine exists. :cite[src-nist-pqc]

So in August 2024 NIST published its first three finalized post-quantum standards, built on mathematical problems that no known quantum algorithm solves efficiently, and urged organizations to start moving to them. :cite[src-nist-pqc]

## Putting it together

A single visit to a secure website now uses every tool in this course. A Diffie–Hellman exchange agrees on fresh keys; a signature on the handshake, backed by a certificate, proves the server's identity; hashes tie each signature to exactly the data signed; and a fast symmetric cipher such as AES encrypts the pages themselves. :cite[src-rfc-8446]

Each layer covers a gap the others leave. Symmetric ciphers cannot distribute keys, key exchange cannot prove identity, and signatures do not keep anything secret. Only together do they give a private, authenticated connection. :cite[src-rfc-8446]

Strong encryption also raises questions that are not mathematical. :contested[Whether messaging services should be required to give police a way to read encrypted messages is fiercely debated between law-enforcement agencies and security researchers.]
