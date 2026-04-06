from typing import Protocol, List
from ..config.schema import DatasetConfig
from ..domain.entities import DatasetRow


class DatasetLoader(Protocol):

    def load_rows(self, dataset_config: DatasetConfig) -> List[DatasetRow]:
        """
        Args:
            dataset_config: Dataset configuration.

        Returns:
            List of dataset rows.
        """
        ...