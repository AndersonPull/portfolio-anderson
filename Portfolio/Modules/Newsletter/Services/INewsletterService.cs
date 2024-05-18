using System.Collections.Generic;
using System.Threading.Tasks;
using Portfolio.Modules.Newsletter.Models;

namespace Portfolio;

public interface INewsletterService
{
   Task<List<ArticleModel>> GetAticlesAsync();
   Task<List<ArticleModel>> GetAticlesMock();
}
