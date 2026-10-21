# TPM (Trusted Platform Module)

A TPM is a small security chip, or firmware that acts like one. It does cryptography and keeps secrets in a place the OS can use but not read. You can ask it to sign, encrypt, or measure, but you can't ask it to hand over a private key.

The TPM does not encrypt your disk. BitLocker does the encryption. The TPM only protects the key that BitLocker uses.

## Forms

| Form | Example | Notes |
|---|---|---|
| Discrete chip | Infineon, STMicro, Nuvoton | Separate chip on the motherboard |
| Firmware (fTPM) | AMD PSP, Intel PTT | Runs inside the CPU's security processor |
| Virtual | swtpm on the host | Software emulation, used by VMs |

Your `win11-lab` VM uses a virtual TPM. libvirt starts swtpm on the host, and the VM reaches it through the `tpm-crb` interface.

## Versions

- **TPM 1.2**: older. Fixed algorithms (SHA-1, RSA).
- **TPM 2.0**: current. Supports algorithm agility, so new algorithms can be added. Windows 11 requires it, along with UEFI and Secure Boot.

## Core concepts

### Keys stay inside the chip

Private keys are created inside the TPM and never leave it. Software asks the TPM to sign or decrypt, and the TPM returns only the result.

### Random numbers

The TPM has a hardware random number generator, used for key generation and nonces (one-time values that stop replay).

### Hierarchies

The TPM groups its keys into hierarchies, each with its own authorization:

- **Endorsement**: identifies the TPM. Holds the endorsement key (EK), created at manufacturing, with a certificate from the maker.
- **Platform**: used by firmware.
- **Owner** (storage): the keys Windows uses day to day. **Clear TPM** resets this hierarchy.
- **Null**: temporary keys, wiped on every reset.

Clear TPM removes the owner's keys. The EK survives.

### PCRs (Platform Configuration Registers)

PCRs record measurements of what ran during boot. You cannot write a PCR directly. You can only extend it:

```
PCR_new = Hash(PCR_old || measurement)
```

Each extend mixes the new measurement into the old value, so the final value depends on every measurement and on their order. A change anywhere in the chain gives a different result.

BitLocker commonly seals its key to PCR 7, which reflects the Secure Boot state.

### Sealing

Sealing encrypts data and binds it to PCR values. The TPM releases the data only when the current PCR values match. If the boot chain changes (for example, a modified bootloader), the PCRs change, the key stays locked, and BitLocker asks for the recovery key.

### Attestation

Attestation proves to a remote party what the machine booted with. The TPM signs the PCR values with an attestation key and includes a nonce, so the signed answer can't be replayed. Windows Device Health Attestation and Intune use this. The verifier compares the values with known-good ones.

### Secure Boot vs measured boot

- **Secure Boot** checks signatures and refuses to run unsigned code. It enforces.
- **Measured boot** records a hash of each boot stage in a PCR. It does not block anything. It records, and a verifier decides later.

## What Windows uses the TPM for

- **BitLocker**: protects the disk-encryption key through sealing.
- **Windows Hello**: PIN and biometric unlock use TPM-protected keys.
- **Device Health Attestation**: a remote check of the boot state.

## Lab note

The TPM in `win11-lab` is software running on the host. The host can read the swtpm state files, and a physical TPM does not allow that. So a VM TPM protects against the guest, but not against an attacker on the host.

## Check yourself

1. Why can't you set a PCR directly? (You can only extend it, so the final value depends on the whole history.)
2. How do sealing and attestation differ? (Sealing releases a local secret only when the PCRs match. Attestation proves the PCR values to a remote party with a signed quote.)
3. What does Clear TPM remove, and what survives? (The owner hierarchy's keys are removed. The EK survives.)
