"""Model definitions for the inference core.

Pure architecture. Tensors in, tensors out. No I/O, no HTTP, no weight loading —
that lives in `pipeline.py`. Keeping this boundary means every model here can be
imported and unit-tested without a network, a checkpoint, or a running service.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn

N_PATHOLOGIES = 14


# ── Variational autoencoder — the distributional gate ────────────────────
class ConvVAE(nn.Module):
    """Convolutional VAE over 128x128 greyscale radiographs.

    Its job is not generation but *rejection*. Trained only on chest
    radiographs, it reconstructs them well and everything else badly, so
    reconstruction error separates in-distribution from out-of-distribution
    inputs. A photograph of a cat produces a large error and is refused before
    the classifier ever runs.

    Syllabus week 7. The latent traversal in `06_vae_ood.ipynb` also
    demonstrates the generative side.
    """

    def __init__(self, latent_dim: int = 128, base: int = 32) -> None:
        super().__init__()
        self.latent_dim = latent_dim

        self.encoder = nn.Sequential(
            self._block(1, base),           # 128 -> 64
            self._block(base, base * 2),    # 64  -> 32
            self._block(base * 2, base * 4),  # 32 -> 16
            self._block(base * 4, base * 8),  # 16 -> 8
        )
        self.flat_dim = base * 8 * 8 * 8
        self.fc_mu = nn.Linear(self.flat_dim, latent_dim)
        self.fc_logvar = nn.Linear(self.flat_dim, latent_dim)
        self.fc_decode = nn.Linear(latent_dim, self.flat_dim)

        self.decoder = nn.Sequential(
            self._up(base * 8, base * 4),
            self._up(base * 4, base * 2),
            self._up(base * 2, base),
            nn.ConvTranspose2d(base, 1, 4, 2, 1),
            nn.Sigmoid(),
        )
        self._base = base

    @staticmethod
    def _block(cin: int, cout: int) -> nn.Sequential:
        return nn.Sequential(
            nn.Conv2d(cin, cout, 4, 2, 1), nn.BatchNorm2d(cout), nn.LeakyReLU(0.2, True)
        )

    @staticmethod
    def _up(cin: int, cout: int) -> nn.Sequential:
        return nn.Sequential(
            nn.ConvTranspose2d(cin, cout, 4, 2, 1),
            nn.BatchNorm2d(cout),
            nn.ReLU(True),
        )

    def encode(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        h = self.encoder(x).flatten(1)
        return self.fc_mu(h), self.fc_logvar(h)

    def reparameterise(self, mu: torch.Tensor, logvar: torch.Tensor) -> torch.Tensor:
        """z = mu + sigma * eps — the trick that makes sampling differentiable."""
        if not self.training:
            return mu  # deterministic at inference so OOD scores are reproducible
        std = torch.exp(0.5 * logvar)
        return mu + std * torch.randn_like(std)

    def decode(self, z: torch.Tensor) -> torch.Tensor:
        h = self.fc_decode(z).view(-1, self._base * 8, 8, 8)
        return self.decoder(h)

    def forward(self, x: torch.Tensor):
        mu, logvar = self.encode(x)
        z = self.reparameterise(mu, logvar)
        return self.decode(z), mu, logvar

    @torch.no_grad()
    def reconstruction_error(self, x: torch.Tensor) -> torch.Tensor:
        """Per-sample MSE. This is the OOD score."""
        recon, _, _ = self.forward(x)
        return F.mse_loss(recon, x, reduction="none").flatten(1).mean(dim=1)


def vae_loss(
    recon: torch.Tensor,
    x: torch.Tensor,
    mu: torch.Tensor,
    logvar: torch.Tensor,
    beta: float = 1.0,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Reconstruction + beta-weighted KL divergence.

    beta > 1 trades reconstruction fidelity for a more disentangled latent
    space (Burgess et al., beta-VAE — a prescribed reading for week 7).
    """
    recon_loss = F.binary_cross_entropy(recon, x, reduction="sum") / x.size(0)
    kl = -0.5 * torch.sum(1 + logvar - mu.pow(2) - logvar.exp()) / x.size(0)
    return recon_loss + beta * kl, recon_loss, kl


# ── Recurrent progression head — syllabus weeks 4 and 5 ──────────────────
class ProgressionRNN(nn.Module):
    """Reads a patient's sequence of per-visit CNN embeddings.

    NIH ChestX-ray14 gives roughly 3-4 studies per patient via `Patient ID` and
    `Follow-up #`, so the sequence is real clinical follow-up rather than a
    synthetic ordering.

    `cell` selects the recurrent unit so the three can be compared under
    identical conditions in `04_lstm_ablation.ipynb` — the ablation that
    satisfies "evaluate the performance of diverse deep learning models".
    """

    def __init__(
        self,
        input_dim: int = 1024,
        hidden_dim: int = 256,
        num_layers: int = 2,
        cell: str = "lstm",
        bidirectional: bool = False,
        dropout: float = 0.3,
        n_outputs: int = N_PATHOLOGIES,
    ) -> None:
        super().__init__()
        cell = cell.lower()
        if cell not in {"rnn", "gru", "lstm"}:
            raise ValueError(f"cell must be rnn, gru or lstm; got {cell!r}")
        self.cell = cell
        self.bidirectional = bidirectional

        rnn_cls = {"rnn": nn.RNN, "gru": nn.GRU, "lstm": nn.LSTM}[cell]
        kwargs = dict(
            input_size=input_dim,
            hidden_size=hidden_dim,
            num_layers=num_layers,
            batch_first=True,
            bidirectional=bidirectional,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        if cell == "rnn":
            kwargs["nonlinearity"] = "tanh"
        self.rnn = rnn_cls(**kwargs)

        out_dim = hidden_dim * (2 if bidirectional else 1)
        self.attention = nn.Linear(out_dim, 1)
        self.head = nn.Sequential(
            nn.Dropout(dropout), nn.Linear(out_dim, out_dim // 2), nn.ReLU(True),
            nn.Dropout(dropout), nn.Linear(out_dim // 2, n_outputs),
        )

    def forward(
        self, x: torch.Tensor, lengths: torch.Tensor | None = None
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """x: (batch, seq_len, input_dim). Returns (logits, attention weights)."""
        out, _ = self.rnn(x)

        scores = self.attention(out).squeeze(-1)  # (batch, seq)
        if lengths is not None:
            # Mask padding before softmax, or padded steps steal attention mass.
            mask = torch.arange(out.size(1), device=x.device)[None, :] >= lengths[:, None]
            scores = scores.masked_fill(mask, float("-inf"))
        weights = torch.softmax(scores, dim=1)

        context = torch.bmm(weights.unsqueeze(1), out).squeeze(1)
        return self.head(context), weights


# ── DCGAN — syllabus week 6 ──────────────────────────────────────────────
class Generator(nn.Module):
    """DCGAN generator for minority-class radiograph synthesis.

    ChestX-ray14 is severely imbalanced — Hernia appears in well under 1% of
    studies. Synthesising additional examples of rare classes and measuring the
    change in minority-class AUC is the experiment in `05_gan_augmentation.ipynb`.
    Architecture follows Radford et al. (a prescribed reading).
    """

    def __init__(self, latent_dim: int = 100, base: int = 64, channels: int = 1) -> None:
        super().__init__()
        self.latent_dim = latent_dim
        self.net = nn.Sequential(
            self._block(latent_dim, base * 8, 4, 1, 0),   # -> 4x4
            self._block(base * 8, base * 4, 4, 2, 1),     # -> 8x8
            self._block(base * 4, base * 2, 4, 2, 1),     # -> 16x16
            self._block(base * 2, base, 4, 2, 1),         # -> 32x32
            nn.ConvTranspose2d(base, channels, 4, 2, 1),  # -> 64x64
            nn.Tanh(),
        )

    @staticmethod
    def _block(cin, cout, k, s, p) -> nn.Sequential:
        return nn.Sequential(
            nn.ConvTranspose2d(cin, cout, k, s, p, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(True),
        )

    def forward(self, z: torch.Tensor) -> torch.Tensor:
        return self.net(z.view(z.size(0), self.latent_dim, 1, 1))


class Discriminator(nn.Module):
    def __init__(self, base: int = 64, channels: int = 1) -> None:
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(channels, base, 4, 2, 1), nn.LeakyReLU(0.2, True),
            self._block(base, base * 2),
            self._block(base * 2, base * 4),
            self._block(base * 4, base * 8),
            nn.Conv2d(base * 8, 1, 4, 1, 0),
        )

    @staticmethod
    def _block(cin, cout) -> nn.Sequential:
        return nn.Sequential(
            nn.Conv2d(cin, cout, 4, 2, 1, bias=False),
            nn.BatchNorm2d(cout),
            nn.LeakyReLU(0.2, True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Logits, not probabilities: BCEWithLogitsLoss is numerically stabler.
        return self.net(x).view(-1)


# ── Monte-Carlo dropout ──────────────────────────────────────────────────
def enable_mc_dropout(model: nn.Module) -> int:
    """Put dropout layers into train mode while everything else stays in eval.

    Calling `model.train()` would also un-freeze BatchNorm running statistics,
    which corrupts predictions. Only Dropout should be stochastic at inference.
    Returns how many layers were enabled so the caller can assert it is non-zero
    — silently sampling a model with no dropout yields T identical passes and a
    fake epistemic uncertainty of zero.
    """
    model.eval()
    count = 0
    for module in model.modules():
        if isinstance(module, (nn.Dropout, nn.Dropout2d, nn.Dropout3d)):
            module.train()
            count += 1
    return count
