namespace Portfolio.Modules.Shared.Models
{
    public class Menu
    {
        public int Id { get; set; }

        public string Text { get; set; }

        public string Page { get; set; }

        public string Icon { get; set; }

        public bool IsSelected { get; set; }
    }
}
