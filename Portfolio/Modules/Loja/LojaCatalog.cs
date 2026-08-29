using System;
using System.Linq;

namespace Portfolio.Modules.Loja;

public sealed class LojaProduct
{
    public string Slug { get; init; }
    public string Title { get; init; }
    public string Kicker { get; init; }
    public string Description { get; init; }
    public string ModelUrl { get; init; }
    public string Kind { get; init; }
    public string Index { get; init; }
}

public static class LojaCatalog
{
    public static readonly LojaProduct[] Items =
    {
        new()
        {
            Slug = "cartucho",
            Title = "Cartucho",
            Kicker = "Produto",
            Description = "Cartucho digital. Software feito para abrir e construir.",
            ModelUrl = "3dModels/Cartucho.glb",
            Kind = "cartucho",
            Index = "— 01"
        },
        new()
        {
            Slug = "controle",
            Title = "Controle",
            Kicker = "Acessório",
            Description = "MobileController. Dual grip para o smartphone.",
            ModelUrl = "3dModels/MobileController.glb",
            Kind = "controle",
            Index = "— 02"
        }
    };

    public static LojaProduct Find(string slug)
        => Items.FirstOrDefault(item =>
            string.Equals(item.Slug, slug, StringComparison.OrdinalIgnoreCase));
}
